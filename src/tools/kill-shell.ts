import type { Tool } from "./types.js";
import { shellManager } from "./shell-manager.js";

// Tue un shell lancé en arrière-plan via Bash run_in_background. Envoie
// SIGTERM puis SIGKILL après 2s si toujours en vie. Pattern Claude Code.
//
// Catégorie permissions : "execute" (action destructive — l'user doit
// confirmer en mode default, auto en accept-edits/bypass).

export const killShellTool: Tool = {
  name: "KillShell",
  description:
    "Tue un shell lancé en arrière-plan via Bash run_in_background. " +
    "Envoie SIGTERM puis SIGKILL après 2s si pas mort. " +
    "Idempotent : si déjà terminé, retourne juste le status courant.",
  formatInvocation: (input) => String(input.shell_id ?? "?"),
  formatResult: (_input, output) => {
    if (output.startsWith("not_found:")) return "shell_id not found";
    const m = /^status:\s*(\w+)/m.exec(output);
    return m ? m[1] : "ok";
  },
  schema: {
    type: "object",
    properties: {
      shell_id: {
        type: "string",
        description: "ID du shell à tuer",
      },
    },
    required: ["shell_id"],
  },
  async run(input) {
    const id = String(input.shell_id ?? "");
    if (!id) throw new Error("KillShell: 'shell_id' manquant");
    const result = shellManager.kill(id);
    if (!result.found) {
      return `not_found: shell_id ${id}`;
    }
    return `shell_id: ${id}\nstatus: ${result.status}`;
  },
};
