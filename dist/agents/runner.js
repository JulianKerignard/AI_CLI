import { AgentLoop } from "../agent/loop.js";
import { ToolRegistry } from "../tools/registry.js";
import { log } from "../utils/logger.js";
export async function runSubAgent(opts) {
    const allowedNames = opts.subAgent.tools;
    const filteredTools = allowedNames
        ? opts.parentTools.filter((t) => allowedNames.includes(t.name))
        : opts.parentTools;
    const childRegistry = new ToolRegistry();
    for (const t of filteredTools)
        childRegistry.register(t);
    log.info(`→ Démarrage du sub-agent '${opts.subAgent.name}' (tools: ${filteredTools.map((t) => t.name).join(", ") || "aucun"})`);
    const loop = new AgentLoop({
        system: opts.subAgent.systemPrompt,
        provider: opts.provider,
        tools: childRegistry,
        cwd: opts.cwd,
        maxIterations: 15,
    });
    const result = await loop.send(opts.prompt);
    log.info(`← Sub-agent '${opts.subAgent.name}' terminé.`);
    return result || "(aucune réponse)";
}
