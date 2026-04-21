import type { Tool } from "../tools/types.js";
import type { SubAgent } from "./types.js";
import type { Provider } from "../agent/provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import { runSubAgent } from "./runner.js";

export function makeAgentTool(opts: {
  subAgents: SubAgent[];
  provider: Provider;
  parentTools: ToolRegistry;
}): Tool {
  return {
    name: "Agent",
    description:
      "Délègue une tâche à un sub-agent spécialisé. Input { name, prompt }. Retourne la réponse finale du sub-agent.",
    schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nom du sub-agent" },
        prompt: { type: "string", description: "Consigne pour le sub-agent" },
      },
      required: ["name", "prompt"],
    },
    async run(input, ctx) {
      const name = String(input.name ?? "");
      const prompt = String(input.prompt ?? "");
      const subAgent = opts.subAgents.find((a) => a.name === name);
      if (!subAgent) {
        return `Sub-agent inconnu: ${name}. Disponibles: ${
          opts.subAgents.map((a) => a.name).join(", ") || "(aucun)"
        }`;
      }
      // Exclut le tool Agent lui-même pour éviter récursion infinie.
      const parentToolsWithoutAgent = opts.parentTools
        .list()
        .filter((t) => t.name !== "Agent");
      return await runSubAgent({
        subAgent,
        prompt,
        provider: opts.provider,
        parentTools: parentToolsWithoutAgent,
        cwd: ctx.cwd,
      });
    },
  };
}
