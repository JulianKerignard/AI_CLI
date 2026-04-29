import { readFile } from "node:fs/promises";
import type { Tool } from "./types.js";
import { resolvePath, guardPath } from "../utils/path-guard.js";
import { shortPath } from "../utils/paths.js";

export const readTool: Tool = {
  name: "Read",
  description: "Lit un fichier du système de fichiers local.",
  formatInvocation: (input) => shortPath(String(input.path ?? "")),
  formatResult: (_input, output) => {
    // Sortie : N lignes numérotées + potentiel "… (N tronquées)". Compte les \n.
    const lines = output.split("\n").length;
    const chars = output.length;
    const kb = chars >= 1024 ? ` · ${(chars / 1024).toFixed(1)} kB` : "";
    return `${lines} lines${kb}`;
  },
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Chemin du fichier à lire" },
    },
    required: ["path"],
  },
  async run(input, ctx) {
    const raw = String(input.path ?? "");
    if (!raw) throw new Error("Read: 'path' manquant");
    const abs = resolvePath(raw, ctx.cwd);
    guardPath(abs, { mode: "read", cwd: ctx.cwd });
    const content = await readFile(abs, "utf8");
    const lines = content.split(/\r?\n/);
    const numbered = lines
      .slice(0, 2000)
      .map((l, i) => `${String(i + 1).padStart(5)}\t${l}`)
      .join("\n");
    const truncated = lines.length > 2000 ? `\n… (${lines.length - 2000} lignes tronquées)` : "";
    return numbered + truncated;
  },
};
