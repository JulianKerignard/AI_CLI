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

export interface AgentOptions {
  system: string;
  provider: Provider;
  tools: ToolRegistry;
  cwd: string;
  maxIterations?: number;
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
      const response = await this.opts.provider.chat({
        system: this.opts.system,
        messages: this.messages,
        tools: this.opts.tools.list(),
      });

      if (response.usage) {
        turnInputTokens += response.usage.inputTokens;
        turnOutputTokens += response.usage.outputTokens;
      }
      if (response.quota) lastQuota = response.quota;

      this.messages.push({ role: "assistant", content: response.content });

      const text = extractText(response.content);
      if (text) log.assistant(text);
      finalText = text || finalText;

      if (response.stopReason !== "tool_use") {
        this.stats.inputTokens += turnInputTokens;
        this.stats.outputTokens += turnOutputTokens;
        this.stats.turns += 1;
        if (lastQuota) this.stats.lastQuota = lastQuota;
        log.status(
          formatTurnStatus(
            turnInputTokens,
            turnOutputTokens,
            lastQuota,
            this.opts.provider.name,
          ),
        );
        return finalText;
      }

      // Exécute chaque tool_use et injecte les tool_result en un seul message user.
      const toolResults: ContentBlock[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        this.stats.toolCalls += 1;
        this.opts.onToolUse?.(block.name, block.input);
        log.tool(block.name, JSON.stringify(block.input).slice(0, 120));
        try {
          const output = await this.opts.tools.run(block.name, block.input, ctx);
          this.opts.onToolResult?.(block.name, output);
          log.toolResult(output);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: output,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`[${block.name}] ${msg}`);
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
