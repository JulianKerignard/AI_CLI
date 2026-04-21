import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Tool } from "./types.js";

export const readTool: Tool = {
  name: "Read",
  description: "Lit un fichier du système de fichiers local.",
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
    const abs = isAbsolute(raw) ? raw : resolve(ctx.cwd, raw);
    const content = await readFile(abs, "utf8");
    const lines = content.split("\n");
    const numbered = lines
      .slice(0, 2000)
      .map((l, i) => `${String(i + 1).padStart(5)}\t${l}`)
      .join("\n");
    const truncated = lines.length > 2000 ? `\n… (${lines.length - 2000} lignes tronquées)` : "";
    return numbered + truncated;
  },
};
