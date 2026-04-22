import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { Tool } from "./types.js";

const MAX_ENTRIES = 200;
const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  ".venv",
  "__pycache__",
]);

export const lsTool: Tool = {
  name: "Ls",
  description:
    "Liste le contenu d'un répertoire avec taille et type (d=dir, f=fichier). Ignore node_modules/.git par défaut.",
  formatInvocation: (input) => String(input.path ?? "."),
  formatResult: (_input, output) => {
    // 1 ligne header + "  d/f  size  name" lignes. On compte les types.
    const lines = output.split("\n").slice(1).filter(Boolean);
    let dirs = 0;
    let files = 0;
    for (const l of lines) {
      const m = /^\s{2}([dlf])/.exec(l);
      if (m?.[1] === "d") dirs++;
      else if (m?.[1] === "f" || m?.[1] === "l") files++;
    }
    const total = dirs + files;
    if (total === 0) return "(vide)";
    const parts: string[] = [];
    if (dirs > 0) parts.push(`${dirs} dir${dirs > 1 ? "s" : ""}`);
    if (files > 0) parts.push(`${files} file${files > 1 ? "s" : ""}`);
    return parts.join(", ");
  },
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Chemin (défaut: cwd)" },
      show_hidden: {
        type: "boolean",
        description: "Affiche les entrées cachées (défaut: false)",
      },
    },
  },
  async run(input, ctx) {
    const raw = input.path ? String(input.path) : ctx.cwd;
    const abs = isAbsolute(raw) ? raw : resolve(ctx.cwd, raw);
    const showHidden = Boolean(input.show_hidden ?? false);

    const entries = await readdir(abs, { withFileTypes: true });
    const rows: Array<{ name: string; type: string; size: string }> = [];

    for (const entry of entries) {
      if (!showHidden) {
        if (entry.name.startsWith(".")) continue;
        if (IGNORED.has(entry.name)) continue;
      }
      const type = entry.isDirectory()
        ? "d"
        : entry.isSymbolicLink()
          ? "l"
          : "f";
      let size = "-";
      if (entry.isFile()) {
        try {
          const s = await stat(join(abs, entry.name));
          size = humanSize(s.size);
        } catch {
          size = "?";
        }
      }
      rows.push({
        name: entry.isDirectory() ? entry.name + "/" : entry.name,
        type,
        size,
      });
    }

    rows.sort((a, b) => {
      if (a.type === "d" && b.type !== "d") return -1;
      if (a.type !== "d" && b.type === "d") return 1;
      return a.name.localeCompare(b.name);
    });

    if (rows.length === 0) return `(répertoire vide: ${abs})`;

    const truncated = rows.length > MAX_ENTRIES;
    const shown = truncated ? rows.slice(0, MAX_ENTRIES) : rows;

    const lines = shown.map(
      (r) => `  ${r.type}  ${r.size.padStart(8)}  ${r.name}`,
    );
    const header = `${abs}`;
    const footer = truncated
      ? `\n… (${rows.length - MAX_ENTRIES} entrées tronquées)`
      : "";
    return header + "\n" + lines.join("\n") + footer;
  },
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "K";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + "M";
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + "G";
}
