import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Tool } from "./types.js";

// Glob minimal sans dep : supporte **, *, ?, [abc], {a,b}. Pas de regex full
// (pas besoin pour nos cas). Ignore par défaut node_modules, .git, dist, .next,
// build, .venv, __pycache__ — surchargeable via `include_hidden`.
const DEFAULT_IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  ".venv",
  "__pycache__",
  ".cache",
  ".turbo",
  "out",
]);

const MAX_RESULTS = 500;

export const globTool: Tool = {
  name: "Glob",
  description:
    "Trouve des fichiers par pattern glob (ex: '**/*.ts', 'src/**/*.{ts,tsx}'). Triés par date de modification décroissante. Ignore node_modules, .git, dist, etc. par défaut.",
  formatInvocation: (input) => {
    const pat = String(input.pattern ?? "");
    return pat.length > 50 ? pat.slice(0, 50) + "…" : pat;
  },
  formatResult: (_input, output) => {
    if (output.startsWith("(aucun")) return "0 matches";
    const lines = output.split("\n").filter((l) => l && !l.startsWith("…"));
    const more = /… \((\d+) résultats tronqués\)/.exec(output);
    if (more) return `${lines.length}+${more[1]} matches`;
    return `${lines.length} match${lines.length > 1 ? "es" : ""}`;
  },
  schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Pattern glob (ex: '**/*.ts')",
      },
      path: {
        type: "string",
        description: "Racine de recherche (défaut: cwd)",
      },
      include_hidden: {
        type: "boolean",
        description: "Inclut dossiers cachés / ignorés par défaut",
      },
    },
    required: ["pattern"],
  },
  async run(input, ctx) {
    const pattern = String(input.pattern ?? "");
    if (!pattern) throw new Error("Glob: 'pattern' manquant");
    const rootRaw = input.path ? String(input.path) : ctx.cwd;
    const root = isAbsolute(rootRaw) ? rootRaw : resolve(ctx.cwd, rootRaw);
    const includeHidden = Boolean(input.include_hidden ?? false);

    const regex = globToRegex(pattern);
    const matches: Array<{ path: string; mtime: number }> = [];

    await walk(root, root, regex, matches, includeHidden);

    matches.sort((a, b) => b.mtime - a.mtime);
    if (matches.length === 0) return `(aucun fichier matche ${pattern})`;

    const truncated = matches.length > MAX_RESULTS;
    const shown = truncated ? matches.slice(0, MAX_RESULTS) : matches;
    const lines = shown.map((m) => m.path);
    if (truncated) {
      lines.push(`… (${matches.length - MAX_RESULTS} résultats tronqués)`);
    }
    return lines.join("\n");
  },
};

async function walk(
  current: string,
  root: string,
  regex: RegExp,
  out: Array<{ path: string; mtime: number }>,
  includeHidden: boolean,
): Promise<void> {
  if (out.length >= MAX_RESULTS * 2) return; // Hard stop pour très gros repos.

  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const name = entry.name;
    if (!includeHidden) {
      if (name.startsWith(".") && name !== "." && name !== "..") continue;
      if (DEFAULT_IGNORED.has(name)) continue;
    }
    const full = join(current, name);
    if (entry.isDirectory()) {
      await walk(full, root, regex, out, includeHidden);
    } else if (entry.isFile()) {
      const rel = relative(root, full).split(sep).join("/");
      if (regex.test(rel)) {
        try {
          const s = await stat(full);
          out.push({ path: full, mtime: s.mtimeMs });
        } catch {
          /* fichier disparu entre readdir et stat : ignore */
        }
      }
    }
  }
}

// Glob → regex. Supporte :
//   **   → n'importe quel nombre de segments (y compris 0)
//   *    → n'importe quels caractères sauf /
//   ?    → un caractère sauf /
//   [abc]  → classe
//   {a,b}  → alternation (expansée récursivement)
function globToRegex(pattern: string): RegExp {
  const expanded = expandBraces(pattern);
  const alts = expanded.map((p) => "(?:" + globSegmentToRegex(p) + ")");
  return new RegExp("^(?:" + alts.join("|") + ")$");
}

function globSegmentToRegex(pattern: string): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** : match multi-segments (y compris vide)
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
          continue;
        }
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i++;
    } else if (c === "?") {
      out += "[^/]";
      i++;
    } else if (c === "[") {
      const end = pattern.indexOf("]", i);
      if (end === -1) {
        out += "\\[";
        i++;
      } else {
        out += pattern.slice(i, end + 1);
        i = end + 1;
      }
    } else if ("+.()^$|\\".includes(c)) {
      out += "\\" + c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function expandBraces(pattern: string): string[] {
  const start = pattern.indexOf("{");
  if (start === -1) return [pattern];
  // Trouve le } appairé au même niveau.
  let depth = 0;
  let end = -1;
  for (let i = start; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [pattern];
  const head = pattern.slice(0, start);
  const tail = pattern.slice(end + 1);
  const inner = pattern.slice(start + 1, end);
  const parts = splitTopLevelCommas(inner);
  const out: string[] = [];
  for (const p of parts) {
    for (const expanded of expandBraces(head + p + tail)) out.push(expanded);
  }
  return out;
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const c of s) {
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (c === "," && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out;
}
