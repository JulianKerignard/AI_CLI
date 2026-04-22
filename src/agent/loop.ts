import type {
  Provider,
  Message,
  ContentBlock,
  ProviderQuota,
} from "./provider.js";
import { extractText } from "./provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { log, formatQuotaStatus, formatTurnStatus } from "../utils/logger.js";
import type { PolicyState } from "../permissions/policy.js";
import { decide } from "../permissions/policy.js";
import { askPermission, logDenied } from "../permissions/prompt.js";
import { compactMessages } from "./compactor.js";
import {
  updateStatus,
  setSessionTotals,
  printStatusBlock,
  resetTurn as resetStatusTurn,
  hideStatus,
  showStatus,
  suspendStatus,
  resumeStatus,
} from "../utils/status-bar.js";

export interface AgentOptions {
  system: string;
  provider: Provider;
  tools: ToolRegistry;
  cwd: string;
  maxIterations?: number;
  // Accesseur live vers l'état des permissions — recalculé à chaque tool call
  // pour que /permissions mode ... prenne effet immédiatement.
  getPolicyState?: () => PolicyState;
  // Callbacks pour que le REPL persiste les décisions "always session/persist".
  onAllowSession?: (toolName: string) => void;
  onAllowPersist?: (toolName: string) => void;
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, output: string) => void;
}

export interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  turns: number;
  toolCalls: number;
  lastQuota?: ProviderQuota;
}

export class AgentLoop {
  readonly messages: Message[] = [];
  private opts: AgentOptions & { maxIterations: number };
  private stats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    turns: 0,
    toolCalls: 0,
  };

  constructor(opts: AgentOptions) {
    this.opts = { ...opts, maxIterations: opts.maxIterations ?? 8 };
  }

  getStats(): SessionStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      toolCalls: 0,
    };
  }

  get provider(): Provider {
    return this.opts.provider;
  }

  setProvider(provider: Provider): void {
    this.opts.provider = provider;
  }

  setSystem(system: string): void {
    this.opts.system = system;
  }

  reset(): void {
    this.messages.length = 0;
  }

  appendSystemNote(note: string): void {
    // On l'injecte comme un message user système léger (le vrai Claude utilise system)
    this.messages.push({
      role: "user",
      content: [{ type: "text", text: `[système] ${note}` }],
    });
  }

  async send(userInput: string): Promise<string> {
    this.messages.push({
      role: "user",
      content: [{ type: "text", text: userInput }],
    });
    return await this.runUntilEnd();
  }

  private async runUntilEnd(): Promise<string> {
    const ctx: ToolContext = { cwd: this.opts.cwd };
    let finalText = "";
    // Agrège les tokens de cette commande utilisateur (tous les sous-tours
    // tool_use inclus). Affichés en une seule ligne à la fin.
    let turnInputTokens = 0;
    let turnOutputTokens = 0;
    let lastQuota: ProviderQuota | undefined;

    for (let i = 0; i < this.opts.maxIterations; i++) {
      // Compaction auto avant chaque tour : si l'historique dépasse les
      // seuils (30 msgs ou 60k tokens estimés), résumé les N premiers messages
      // via 1 appel LLM. Préserve les tool_use_id ↔ tool_result pending.
      try {
        updateStatus({ phase: "compacting" });
        await compactMessages(this.messages, this.opts.provider, this.opts.system);
      } catch (err) {
        log.warn(
          `[compact] erreur ignorée : ${err instanceof Error ? err.message : err}`,
        );
      }

      // Status : thinking dès qu'on lance la requête, streaming au 1er delta.
      updateStatus({
        provider: this.opts.provider.name,
        phase: "thinking",
        tokensIn: 0,
        tokensOut: 0,
      });

      // Streaming : on imprime le prefix assistant "●" + les text deltas en
      // live. Pendant le stream, le status est suspendu (évite le flicker
      // du hide/show à chaque token). Il est réactivé à la fin.
      let streamStarted = false;
      let streamedChars = 0;
      const startStream = () => {
        if (streamStarted) return;
        streamStarted = true;
        updateStatus({ phase: "streaming" });
      };

      const { historyStore } = await import("../ui/history-store.js");

      const response = await this.opts.provider.chat({
        system: this.opts.system,
        messages: this.messages,
        tools: this.opts.tools.list(),
        onTextDelta: (delta) => {
          startStream();
          historyStore.appendAssistantDelta(delta);
          streamedChars += delta.length;
          updateStatus({ tokensOut: Math.ceil(streamedChars / 4) });
        },
      });

      // Fin du stream : fige l'item assistant dans l'historique statique.
      if (streamStarted) {
        historyStore.endAssistant();
      }

      if (response.usage) {
        turnInputTokens += response.usage.inputTokens;
        turnOutputTokens += response.usage.outputTokens;
      }
      if (response.quota) lastQuota = response.quota;

      // Update status bar avec les tokens réels + quota dès qu'ils arrivent.
      updateStatus({
        tokensIn: response.usage?.inputTokens ?? 0,
        tokensOut: response.usage?.outputTokens ?? Math.ceil(streamedChars / 4),
        ...(response.quota
          ? {
              quotaUsed: response.quota.used,
              quotaLimit: response.quota.limit,
              resetAt: response.quota.resetAt,
            }
          : {}),
      });

      this.messages.push({ role: "assistant", content: response.content });

      const text = extractText(response.content);
      // Si le stream n'a pas affiché de texte (par ex. response vide ou tool_use
      // only), on n'affiche rien. Si on a streamé du texte, inutile de ré-imprimer.
      if (!streamStarted && text) log.assistant(text);
      finalText = text || finalText;

      if (response.stopReason !== "tool_use") {
        this.stats.inputTokens += turnInputTokens;
        this.stats.outputTokens += turnOutputTokens;
        this.stats.turns += 1;
        setSessionTotals(this.stats.inputTokens, this.stats.outputTokens);
        updateStatus({ phase: "idle" });
        if (lastQuota) this.stats.lastQuota = lastQuota;
        // Block status inline à la fin de chaque turn complet (pas persistent :
        // scrolle naturellement comme le reste, pas de race avec readline).
        printStatusBlock();
        return finalText;
      }

      // Exécute chaque tool_use et injecte les tool_result en un seul message user.
      const toolResults: ContentBlock[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        this.stats.toolCalls += 1;

        // Gate permissions AVANT d'appeler tools.run.
        const policy = this.opts.getPolicyState?.();
        if (policy) {
          const d = decide(policy, block.name);
          if (d === "deny") {
            logDenied(
              block.name,
              policy.mode === "plan"
                ? "mode plan (read-only)"
                : "refusé par règle",
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Tool ${block.name} refusé par la politique de permissions (mode ${policy.mode}).`,
              is_error: true,
            });
            continue;
          }
          if (d === "ask") {
            const decision = await askPermission(block.name, block.input);
            if (decision === "deny") {
              logDenied(block.name, "refusé par l'utilisateur");
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: `L'utilisateur a refusé l'exécution de ${block.name}. Propose une alternative ou demande comment procéder.`,
                is_error: true,
              });
              continue;
            }
            if (decision === "allow-session") {
              this.opts.onAllowSession?.(block.name);
            }
            if (decision === "allow-persist") {
              this.opts.onAllowPersist?.(block.name);
            }
          }
        }

        this.opts.onToolUse?.(block.name, block.input);
        updateStatus({ phase: "executing-tool", toolName: block.name });

        // Affichage compact Claude-Code-style : ◆ Name(label). Le résumé du
        // résultat est ajouté après l'exécution. Si le tool ne fournit pas de
        // formatters, fallback sur l'ancien affichage verbeux.
        const toolDef = this.opts.tools.get(block.name);
        const hasCompact = !!(toolDef?.formatInvocation || toolDef?.formatResult);
        hideStatus();
        if (hasCompact) {
          const label = toolDef?.formatInvocation?.(block.input) ?? "";
          log.toolCompact(block.name, label);
        } else {
          log.tool(block.name, JSON.stringify(block.input).slice(0, 120));
        }

        try {
          const output = await this.opts.tools.run(block.name, block.input, ctx);
          this.opts.onToolResult?.(block.name, output);
          if (hasCompact && toolDef?.formatResult) {
            log.toolResultCompact(toolDef.formatResult(block.input, output));
          } else if (!hasCompact) {
            log.toolResult(output);
          } else {
            // Tool a formatInvocation mais pas formatResult : 1 ligne générique.
            const lines = output.split("\n").length;
            log.toolResultCompact(`${lines} lines returned`);
          }
          showStatus();
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: output,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (hasCompact) {
            log.toolResultCompact(msg, true);
          } else {
            log.error(`[${block.name}] ${msg}`);
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Erreur: ${msg}`,
            is_error: true,
          });
        }
      }
      this.messages.push({ role: "user", content: toolResults });
    }

    log.warn(`Boucle agent: limite d'itérations (${this.opts.maxIterations}) atteinte.`);
    this.stats.inputTokens += turnInputTokens;
    this.stats.outputTokens += turnOutputTokens;
    this.stats.turns += 1;
    if (lastQuota) this.stats.lastQuota = lastQuota;
    return finalText;
  }
}

// Ré-export helper pour consommation externe (commande /usage).
export { formatQuotaStatus };
