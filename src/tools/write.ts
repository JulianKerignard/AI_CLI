import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Tool } from "./types.js";

export const writeTool: Tool = {
  name: "Write",
  description: "Écrit (ou écrase) un fichier avec le contenu fourni.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Chemin du fichier" },
      content: { type: "string", description: "Contenu à écrire" },
    },
    required: ["path", "content"],
  },
  async run(input, ctx) {
    const raw = String(input.path ?? "");
    const content = String(input.content ?? "");
    if (!raw) throw new Error("Write: 'path' manquant");
    const abs = isAbsolute(raw) ? raw : resolve(ctx.cwd, raw);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return `Écrit ${content.length} caractères dans ${abs}`;
  },
};
