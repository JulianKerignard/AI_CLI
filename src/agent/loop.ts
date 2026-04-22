import type { Provider, Message, ContentBlock } from "./provider.js";
import { extractText } from "./provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { log } from "../utils/logger.js";

export interface AgentOptions {
  system: string;
  provider: Provider;
  tools: ToolRegistry;
  cwd: string;
  maxIterations?: number;
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, output: string) => void;
}

export class AgentLoop {
  readonly messages: Message[] = [];
  private opts: AgentOptions & { maxIterations: number };

  constructor(opts: AgentOptions) {
    this.opts = { ...opts, maxIterations: opts.maxIterations ?? 8 };
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

    for (let i = 0; i < this.opts.maxIterations; i++) {
      const response = await this.opts.provider.chat({
        system: this.opts.system,
        messages: this.messages,
        tools: this.opts.tools.list(),
      });

      this.messages.push({ role: "assistant", content: response.content });

      const text = extractText(response.content);
      if (text) log.assistant(text);
      finalText = text || finalText;

      if (response.stopReason !== "tool_use") return finalText;

      // Exécute chaque tool_use et injecte les tool_result en un seul message user.
      const toolResults: ContentBlock[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
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
    return finalText;
  }
}
