import type { Tool } from "./types.js";
import { shellManager } from "./shell-manager.js";

// Lit les logs accumulés d'un shell lancé en arrière-plan via Bash
// run_in_background. Pattern Claude Code : l'agent peut poll les logs
// au fil de l'eau sans bloquer la boucle. Le delta est calculé depuis
// la dernière lecture (lastReadOffset géré par ShellManager) — l'agent
// voit uniquement le nouveau stdout depuis le dernier appel.
//
// stderr est retourné en entier à chaque appel (souvent court, infos
// d'erreur précieuses même en re-read).

export const bashOutputTool: Tool = {
  name: "BashOutput",
  description:
    "Lit les logs accumulés d'un shell lancé en arrière-plan (Bash run_in_background). " +
    "Retourne le delta stdout depuis la dernière lecture + stderr complet + status. " +
    "filter optionnel : regex appliquée ligne par ligne sur stdout (ex: 'ERROR|WARN').",
  formatInvocation: (input) => {
    const id = String(input.shell_id ?? "?");
    const filter = input.filter ? ` /${String(input.filter)}/` : "";
    return id + filter;
  },
  formatResult: (_input, output) => {
    if (output.startsWith("not_found:")) return "shell_id not found";
    const statusMatch = /^status:\s*(\w+)/m.exec(output);
    const linesMatch = /^stdout_lines:\s*(\d+)/m.exec(output);
    const status = statusMatch ? statusMatch[1] : "?";
    const lines = linesMatch ? linesMatch[1] : "0";
    return `${status} · ${lines} new stdout lines`;
  },
  schema: {
    type: "object",
    properties: {
      shell_id: {
        type: "string",
        description: "ID du shell retourné par Bash run_in_background",
      },
      filter: {
        type: "string",
        description: "Regex optionnelle, filtre les lignes stdout matchantes",
      },
    },
    required: ["shell_id"],
  },
  async run(input) {
    const id = String(input.shell_id ?? "");
    if (!id) throw new Error("BashOutput: 'shell_id' manquant");
    const rawFilter = input.filter ? String(input.filter) : null;
    let filter: RegExp | undefined;
    if (rawFilter) {
      try {
        filter = new RegExp(rawFilter);
      } catch (err) {
        throw new Error(
          `BashOutput: regex 'filter' invalide (${err instanceof Error ? err.message : err})`,
        );
      }
    }
    const result = shellManager.getOutput(id, filter);
    if (!result.found) {
      return `not_found: shell_id ${id} (peut-être déjà évincé via /shells clean ou jamais lancé)`;
    }
    const stdoutLines = result.stdout
      ? result.stdout.split(/\r?\n/).filter(Boolean).length
      : 0;
    const lines: string[] = [
      `shell_id: ${id}`,
      `status: ${result.status}`,
      `runtime_ms: ${result.runtimeMs}`,
      `exit_code: ${result.exitCode ?? "—"}`,
      `stdout_lines: ${stdoutLines}`,
    ];
    if (result.stdout) {
      lines.push("");
      lines.push("stdout:");
      lines.push(result.stdout);
    }
    if (result.stderr) {
      lines.push("");
      lines.push("stderr:");
      lines.push(result.stderr);
    }
    return lines.join("\n");
  },
};
