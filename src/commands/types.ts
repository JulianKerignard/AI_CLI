import type { AgentLoop } from "../agent/loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Skill } from "../skills/types.js";
import type { SubAgent } from "../agents/types.js";
import type { McpServer } from "../mcp/client.js";

export interface CommandContext {
  agent: AgentLoop;
  tools: ToolRegistry;
  skills: Skill[];
  subAgents: SubAgent[];
  mcpServers: McpServer[];
  exit: () => void;
}

export interface SlashCommand {
  name: string;
  description: string;
  run: (ctx: CommandContext, args: string) => Promise<void>;
}
