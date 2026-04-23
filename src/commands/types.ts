import type { AgentLoop } from "../agent/loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Skill } from "../skills/types.js";
import type { SubAgent } from "../agents/types.js";
import type { McpServer } from "../mcp/client.js";
import type { Credentials } from "../auth/store.js";
import type { PermissionMode } from "../permissions/policy.js";

export interface AuthHandlers {
  getCredentials: () => Credentials | null;
  onLogin: (creds: Credentials) => void;
  onLogout: () => void;
}

export interface PermissionsHandlers {
  getMode: () => PermissionMode;
  setMode: (mode: PermissionMode, persist?: boolean) => void;
  getAlwaysAllow: () => string[];
  addAlwaysAllow: (toolName: string) => void;
  removeAlwaysAllow: (toolName: string) => void;
  getSessionAllowed: () => string[];
  clearSessionAllowed: () => void;
}

export interface CommandContext {
  agent: AgentLoop;
  tools: ToolRegistry;
  skills: Skill[];
  subAgents: SubAgent[];
  mcpServers: McpServer[];
  auth: AuthHandlers;
  permissions: PermissionsHandlers;
  exit: () => void;
  /** Force le watcher à re-fetcher /api/v1/models immédiatement. */
  refreshCatalog?: () => void;
}

export interface SlashCommand {
  name: string;
  description: string;
  run: (ctx: CommandContext, args: string) => Promise<void>;
}
