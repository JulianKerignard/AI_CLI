import type { SubAgent } from "./types.js";
import type { Provider } from "../agent/provider.js";
import { AgentLoop } from "../agent/loop.js";
import { ToolRegistry } from "../tools/registry.js";
import type { Tool } from "../tools/types.js";
import type { PolicyState } from "../permissions/policy.js";
import { log } from "../utils/logger.js";

export interface RunSubAgentOpts {
  subAgent: SubAgent;
  prompt: string;
  provider: Provider;
  parentTools: Tool[];
  cwd: string;
  // Propagation du policy engine parent : sans ça, le sub-agent bypass
  // le mode plan/default du parent et exécute tous les tools sans prompt.
  // Fix pour la vuln "plan mode bypassable via Agent tool".
  getPolicyState?: () => PolicyState;
  onAllowSession?: (toolName: string) => void;
  onAllowPersist?: (toolName: string) => void;
}

export async function runSubAgent(opts: RunSubAgentOpts): Promise<string> {
  const allowedNames = opts.subAgent.tools;
  const filteredTools = allowedNames
    ? opts.parentTools.filter((t) => allowedNames.includes(t.name))
    : opts.parentTools;

  const childRegistry = new ToolRegistry();
  for (const t of filteredTools) childRegistry.register(t);

  log.info(
    `→ Démarrage du sub-agent '${opts.subAgent.name}' (tools: ${
      filteredTools.map((t) => t.name).join(", ") || "aucun"
    })`,
  );

  const loop = new AgentLoop({
    system: opts.subAgent.systemPrompt,
    provider: opts.provider,
    tools: childRegistry,
    cwd: opts.cwd,
    maxIterations: 15,
    getPolicyState: opts.getPolicyState,
    onAllowSession: opts.onAllowSession,
    onAllowPersist: opts.onAllowPersist,
  });

  const result = await loop.send(opts.prompt);
  log.info(`← Sub-agent '${opts.subAgent.name}' terminé.`);
  return result || "(aucune réponse)";
}
