import type { Tool, ToolContext } from "./types.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { lsTool } from "./ls.js";
import { askTool } from "./ask.js";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  async run(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Outil inconnu: ${name}`);
    return await tool.run(input, ctx);
  }
}

export function createBaseRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(lsTool);
  registry.register(bashTool);
  registry.register(askTool);
  return registry;
}
