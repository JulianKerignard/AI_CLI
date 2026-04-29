import type {
  Provider,
  Message,
  ContentBlock,
  ProviderQuota,
  ProviderResponse,
} from "./provider.js";
import { extractText } from "./provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { log, formatQuotaStatus, formatTurnStatus } from "../utils/logger.js";
import type { PolicyState } from "../permissions/policy.js";
import { decide } from "../permissions/policy.js";
import { askPermission, logDenied } from "../permissions/prompt.js";
import { estimateTokens } from "./compactor.js";
import {
  contextWindowFor,
  estimateBaselineTokens,
} from "../lib/context-window.js";
import { historyStore } from "../ui/history-store.js";
import {
  updateStatus,
  setSessionTotals,
  resetTurn as resetStatusTurn,
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
  // Session recorder (ex: écrit chaque message dans un JSONL). Optionnel.
  onRecord?: (
    type: "user" | "assistant" | "tool_use" | "tool_result",
    content: unknown,
  ) => void;
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
  // Soft warning ctx : 1 fois par session pour éviter le spam si l'user
  // continue à charger des fichiers volumineux. Reset au /clear via
  // resetStats().
  private warnedNearCtxLimit = false;

  // True quand on est dans un cluster de tools read-only (Read/Glob/Grep/
  // Ls) — visuellement groupés sous un kicker `Thinking…`. Reset au
  // début de chaque turn user et à chaque write/exec tool ou text delta
  // qui clôt le bloc.
  private inThinkingCluster = false;

  constructor(opts: AgentOptions) {
    // Default 25 (aligné Claude Code) pour laisser les tâches multi-étapes aboutir.
    // Overridable via AICLI_MAX_ITERATIONS pour les power users.
    const envLimit = Number(process.env.AICLI_MAX_ITERATIONS);
    const defaultLimit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 25;
    this.opts = { ...opts, maxIterations: opts.maxIterations ?? defaultLimit };
    // Bind l'emitter d'interruption UI (Esc dans Ink). Lazy import pour
    // éviter une dépendance circulaire au load (loop ↔ ui).
    void import("../ui/interrupt-controller.js").then(
      ({ interruptController }) => {
        interruptController.on("interrupt", () => {
          this.abort();
        });
      },
    );
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
    this.warnedNearCtxLimit = false;
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

  // Controller actif pendant un tour send(). Permet à l'UI Ink de signaler
  // un abort (Esc) qui propage jusqu'au fetch + reader SSE du provider.
  // Reset à null entre les tours.
  private currentAbort: AbortController | null = null;

  abort(): boolean {
    if (!this.currentAbort) return false;
    this.currentAbort.abort();
    return true;
  }

  appendSystemNote(note: string): void {
    // On l'injecte comme un message user système léger (le vrai Claude utilise system)
    this.messages.push({
      role: "user",
      content: [{ type: "text", text: `[système] ${note}` }],
    });
  }

  async send(userInput: string): Promise<string> {
    // 1. Auto-détection de paths image dans le prompt (drag-drop terminal
    //    insère un path, user ajoute sa question à côté). Extrait, attache,
    //    strip du texte. Tolère quotes (iTerm2) + paths avec espaces.
    const { addImage, takeAllAndClear } = await import(
      "../ui/pending-images.js"
    );
    const imgRegex =
      /(?:'([^']+\.(?:png|jpe?g|webp|gif))'|"([^"]+\.(?:png|jpe?g|webp|gif))"|(\S+\.(?:png|jpe?g|webp|gif)))/gi;
    let cleanedText = userInput;
    const detectedPaths: string[] = [];
    for (const m of userInput.matchAll(imgRegex)) {
      const path = m[1] ?? m[2] ?? m[3];
      if (path) detectedPaths.push(path);
    }
    for (const path of detectedPaths) {
      try {
        const item = await addImage(path, this.opts.cwd);
        cleanedText = cleanedText.replace(new RegExp(`['"]?${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]?`, "g"), "").trim();
        log.info(
          `Image détectée et attachée : ${item.displayName} (${Math.round(item.sizeBytes / 1024)}k)`,
        );
      } catch (err) {
        // Path existe pas ou extension invalide : laisse tel quel dans le texte.
        log.faint(
          `(path ${path} ignoré : ${(err as Error).message})`,
        );
      }
    }
    if (!cleanedText) cleanedText = "décris cette image";

    // 2. Récupère TOUTES les images attachées (auto-détectées + /image).
    const pending = takeAllAndClear();
    const content: ContentBlock[] = [];
    if (pending.length > 0) {
      const { modelSupportsVision } = await import("./provider.js");
      const modelId = this.opts.provider.name.replace(/^http\(|\)$/g, "");
      const supports = await modelSupportsVision(modelId);
      if (!supports) {
        log.warn(
          `${modelId} ne supporte pas la vision — ${pending.length} image(s) ignorée(s). Switch sur mistral-* ou gemini-* via /model.`,
        );
      } else {
        // Anthropic format : images AVANT le texte pour que le modèle les
        // "voie" avec le contexte de la question qui suit.
        for (const img of pending) content.push(img.block);
      }
    }
    content.push({ type: "text", text: cleanedText });
    this.messages.push({ role: "user", content });
    this.opts.onRecord?.("user", cleanedText);
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
    // Nouveau turn → bloc Thinking neuf (le prochain read-only tool
    // affichera le kicker `Thinking…`).
    this.inThinkingCluster = false;

    for (let i = 0; i < this.opts.maxIterations; i++) {
      // Compaction MANUELLE uniquement (via /compact). Avant : compaction
      // auto silencieuse à 60-70% du ctx window, ce qui surprenait l'user
      // au milieu d'une longue tâche (1 appel LLM en plus + perte de
      // détails). Maintenant on warn quand on approche, et on hard-stop
      // si on dépasse vraiment (sinon le provider crash 400).
      const ctxWin = contextWindowFor(this.opts.provider.name);
      const estimated = estimateTokens(this.messages) * 1.2;
      if (estimated > ctxWin) {
        log.error(
          `Historique trop gros (~${Math.round(estimated)} tokens > ${ctxWin} ctx window). ` +
            `Tape /compact pour résumer l'historique, ou /clear pour repartir à zéro.`,
        );
        return finalText;
      }
      if (!this.warnedNearCtxLimit && estimated > ctxWin * 0.8) {
        this.warnedNearCtxLimit = true;
        log.faint(
          `(historique à ~${Math.round((estimated / ctxWin) * 100)}% du ctx — tape /compact si besoin)`,
        );
      }

      // Status : 'loading' pendant la phase pre-premier-token (cold start
      // NVIDIA peut être long). Passe à 'streaming' dès le 1er delta.
      updateStatus({
        provider: this.opts.provider.name,
        phase: "loading",
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

      // Wrapper retry-on-upstream-error : si le provider throw un 429
      // déguisé (stream coupé mid-way, "terminated"), on pause avec
      // "waiting quota" + retry automatique au lieu de montrer l'erreur.
      const callProviderWithRetry = async (): Promise<ProviderResponse> => {
        const MAX_RETRIES = 3;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          // Nouveau controller par tentative — abort() ferme celle en cours
          // sans affecter les retries futurs.
          this.currentAbort = new AbortController();
          try {
            return await this.opts.provider.chat({
              system: this.opts.system,
              messages: this.messages,
              tools: this.opts.tools.list(),
              signal: this.currentAbort.signal,
              onTextDelta: (delta) => {
                startStream();
                // Premier delta = l'agent passe à la rédaction de la
                // réponse → le bloc Thinking se ferme. Le prochain
                // read-only tool d'un futur turn ouvrira un nouveau
                // cluster avec son kicker.
                this.inThinkingCluster = false;
                historyStore.appendAssistantDelta(delta);
                streamedChars += delta.length;
                updateStatus({ tokensOut: Math.ceil(streamedChars / 4) });
              },
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const errName = err instanceof Error ? err.name : "";
            // AbortError (user Esc) : pas de retry, propagation directe.
            if (errName === "AbortError" || /interrompue par l'utilisateur/i.test(msg)) {
              throw err;
            }
            const isRetryable =
              /rate limit|quota|terminated|upstream|500|502|503|504/i.test(
                msg,
              ) && attempt < MAX_RETRIES - 1;
            if (!isRetryable) throw err;
            // Pause progressive 15s → 30s → 60s avec countdown.
            const waitMs = 15_000 * (attempt + 1);
            updateStatus({
              phase: "waiting-quota",
              waitingMsRemaining: waitMs,
              toolName: `retry ${attempt + 1}/${MAX_RETRIES}`,
            });
            const end = Date.now() + waitMs;
            while (Date.now() < end) {
              updateStatus({
                waitingMsRemaining: Math.max(0, end - Date.now()),
              });
              await new Promise((r) => setTimeout(r, 500));
            }
            updateStatus({
              phase: "loading",
              waitingMsRemaining: undefined,
              toolName: undefined,
            });
          }
        }
        throw new Error("Max retries atteint");
      };
      let response: ProviderResponse;
      try {
        response = await callProviderWithRetry();
      } catch (err) {
        // L'user a appuyé sur Esc → on close proprement le tour avec ce
        // qu'on a déjà streamé, on push un message assistant partiel dans
        // l'historique pour que la conversation puisse reprendre, et on
        // retourne. Pas de propagation d'erreur jusqu'au REPL.
        const errName = err instanceof Error ? err.name : "";
        const errMsg = err instanceof Error ? err.message : String(err);
        if (
          errName === "AbortError" ||
          /interrompue par l'utilisateur/i.test(errMsg)
        ) {
          if (streamStarted) historyStore.endAssistant();
          this.currentAbort = null;
          updateStatus({ phase: "idle" });
          // Push un message assistant texte avec ce qu'on a streamé pour
          // garder l'historique cohérent (sinon le prochain tour user se
          // retrouve avec un trou et le modèle peut réagir bizarrement).
          const partial = historyStore.getAssistantPartial();
          if (partial) {
            this.messages.push({
              role: "assistant",
              content: [{ type: "text", text: partial }],
            });
          }
          log.faint("(génération interrompue par Esc)");
          return partial;
        }
        this.currentAbort = null;
        throw err;
      }
      this.currentAbort = null;

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
      // baselineTokens = coût system prompt + tools schemas. Permet au
      // render du ctx d'exclure ce qui n'est PAS de la conversation user
      // (affichage "salut" = ~0k au lieu de 3k).
      const baselineTokens = estimateBaselineTokens(
        this.opts.system,
        this.opts.tools.list(),
      );
      updateStatus({
        tokensIn: response.usage?.inputTokens ?? 0,
        tokensOut: response.usage?.outputTokens ?? Math.ceil(streamedChars / 4),
        baselineTokens,
        ...(response.quota
          ? {
              quotaUsed: response.quota.used,
              quotaLimit: response.quota.limit,
              resetAt: response.quota.resetAt,
            }
          : {}),
      });

      this.messages.push({ role: "assistant", content: response.content });
      this.opts.onRecord?.("assistant", response.content);

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

        // Détecte si l'outil est "read-only" (Read/Glob/Grep/Ls et leurs
        // équivalents MCP). Ces actions sont regroupées visuellement dans
        // un bloc Thinking au lieu d'apparaître chacune comme un ◆ Name
        // séparé — l'agent enchaîne souvent 5-10 read-only avant d'agir,
        // ce qui produisait un mur de tool calls peu lisible.
        const baseName = block.name.replace(/^mcp__[^_]+__/, "");
        const isReadOnly =
          baseName === "Read" ||
          baseName === "Glob" ||
          baseName === "Grep" ||
          baseName === "Ls" ||
          baseName.toLowerCase().startsWith("read") ||
          baseName.toLowerCase().startsWith("search") ||
          baseName.toLowerCase().startsWith("find");

        // Affichage compact Claude-Code-style : ◆ Name(label). Le résumé du
        // résultat est ajouté après l'exécution. Si le tool ne fournit pas de
        // formatters, fallback sur l'ancien affichage verbeux.
        const toolDef = this.opts.tools.get(block.name);
        const hasCompact = !!(toolDef?.formatInvocation || toolDef?.formatResult);
        const invocLabel = toolDef?.formatInvocation?.(block.input) ?? "";

        if (isReadOnly) {
          // Thinking line `> Reading X` ou `> Searching X` selon le verbe.
          const verb =
            baseName === "Read" || baseName.toLowerCase().startsWith("read")
              ? "Reading"
              : baseName === "Grep" || baseName.toLowerCase().startsWith("search")
                ? "Searching"
                : baseName === "Glob"
                  ? "Globbing"
                  : baseName === "Ls"
                    ? "Listing"
                    : "Inspecting";
          log.thinking(
            "read",
            `${verb} ${invocLabel || baseName}`,
            !this.inThinkingCluster,
          );
          this.inThinkingCluster = true;
        } else if (hasCompact) {
          // Tool action (write/exec/autre) : ferme le cluster et affiche
          // le format standard ◆ Name(args).
          this.inThinkingCluster = false;
          log.toolCompact(block.name, invocLabel);
        } else {
          this.inThinkingCluster = false;
          log.tool(block.name, JSON.stringify(block.input).slice(0, 120));
        }

        try {
          const output = await this.opts.tools.run(block.name, block.input, ctx);
          this.opts.onToolResult?.(block.name, output);
          if (isReadOnly) {
            // Résumé en thinking line `done` — concise (formatResult).
            const summary =
              toolDef?.formatResult?.(block.input, output) ?? "ok";
            log.thinking("done", summary);
          } else if (hasCompact && toolDef?.formatResult) {
            log.toolResultCompact(toolDef.formatResult(block.input, output));
          } else if (!hasCompact) {
            log.toolResult(output);
          } else {
            // Tool a formatInvocation mais pas formatResult : 1 ligne générique.
            const lines = output.split("\n").length;
            log.toolResultCompact(`${lines} lines returned`);
          }
          // Confirmation `✓ Applied fix to <path>` style GLM Coding
          // Assistant pour les actions d'écriture (modification disque).
          // Pas pour Read/Bash/Grep — le ⎿ result suffit. baseName déjà
          // calculé au-dessus pour le test isReadOnly.
          if (
            baseName === "Edit" ||
            baseName === "MultiEdit" ||
            baseName === "Write"
          ) {
            const rawPath = String(block.input.path ?? "");
            if (rawPath) {
              const action = baseName === "Write" ? "Created" : "Applied fix to";
              const { shortPath } = await import("../utils/paths.js");
              log.applied(action, shortPath(rawPath));
            }
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: output,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Erreur sur un read-only : casse le cluster (warn classique).
          this.inThinkingCluster = false;
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
      // Record les tool_results pour que /resume restore l'état complet.
      this.opts.onRecord?.("tool_result", toolResults);
    }

    log.warn(
      `Boucle agent: limite d'itérations (${this.opts.maxIterations}) atteinte. ` +
        `Tape \`continue\` pour reprendre ou set AICLI_MAX_ITERATIONS=50 pour augmenter la limite.`,
    );
    this.stats.inputTokens += turnInputTokens;
    this.stats.outputTokens += turnOutputTokens;
    this.stats.turns += 1;
    if (lastQuota) this.stats.lastQuota = lastQuota;
    return finalText;
  }
}

