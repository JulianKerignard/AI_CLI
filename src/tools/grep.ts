import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import type { Tool } from "./types.js";

// Grep : wrapper ripgrep si dispo (très rapide), fallback implémentation maison.
// Modes output : files_with_matches (défaut) | content | count.

// 25k bytes ≈ 6k tokens — un grep qui dépasse demande à l'agent d'affiner.
// Avant : 100k = 25% d'une fenêtre 128k consommée en 1 tool call.
const MAX_OUTPUT_BYTES = 25_000;

export const grepTool: Tool = {
  name: "Grep",
  description:
    "Recherche un pattern regex dans les fichiers. Utilise ripgrep si disponible (ignore .gitignore par défaut). Modes : files_with_matches | content | count.",
  formatInvocation: (input) => {
    const pattern = String(input.pattern ?? "");
    const truncated =
      pattern.length > 40 ? pattern.slice(0, 40) + "…" : pattern;
    const glob = input.glob ? ` in ${String(input.glob)}` : "";
    // Préfixe '/' pour évoquer un pattern de recherche (style :/cmd vim
    // ou regex inline). Disambig visuel avec les paths Read/Write/Edit.
    return "/" + truncated + glob;
  },
  formatResult: (input, output) => {
    if (output.startsWith("(aucun")) return "0 matches";
    const mode = String(input.output_mode ?? "files_with_matches");
    const lines = output.split(/\r?\n/).filter(Boolean);
    const more = /… \((\d+) lignes tronquées\)/.exec(output);
    const n = lines.length - (more ? 1 : 0);
    if (mode === "content") return `${n}${more ? "+" : ""} matching lines`;
    if (mode === "count") return `${n} files with matches`;
    return `${n} file${n > 1 ? "s" : ""}`;
  },
  schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Pattern regex à chercher",
      },
      path: {
        type: "string",
        description: "Fichier ou répertoire de recherche (défaut: cwd)",
      },
      glob: {
        type: "string",
        description: "Filtre glob sur les fichiers (ex: '*.ts')",
      },
      output_mode: {
        type: "string",
        description: "files_with_matches (défaut) | content | count",
      },
      case_insensitive: {
        type: "boolean",
        description: "Recherche insensible à la casse",
      },
      context: {
        type: "number",
        description: "Nombre de lignes de contexte avant/après (mode content)",
      },
      head_limit: {
        type: "number",
        description: "Limite de résultats (défaut: 100)",
      },
    },
    required: ["pattern"],
  },
  async run(input, ctx) {
    const pattern = String(input.pattern ?? "");
    if (!pattern) throw new Error("Grep: 'pattern' manquant");
    const rawPath = input.path ? String(input.path) : ctx.cwd;
    const searchPath = isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath);
    const glob = input.glob ? String(input.glob) : undefined;
    const outputMode = String(input.output_mode ?? "files_with_matches");
    const caseInsensitive = Boolean(input.case_insensitive ?? false);
    const contextLines = toNumber(input.context);
    const headLimit = toNumber(input.head_limit) ?? 50;

    // Essaie ripgrep d'abord (rapide, respecte .gitignore).
    const rgArgs: string[] = [];
    if (caseInsensitive) rgArgs.push("-i");
    if (glob) rgArgs.push("--glob", glob);
    if (outputMode === "files_with_matches") rgArgs.push("-l");
    else if (outputMode === "count") rgArgs.push("-c");
    else if (outputMode === "content") {
      rgArgs.push("-n");
      if (contextLines) rgArgs.push("-C", String(contextLines));
    }
    rgArgs.push("--color", "never", "--", pattern, searchPath);

    try {
      const result = await runProcess("rg", rgArgs);
      if (result.stdout.trim().length === 0 && result.code === 1) {
        return `(aucun match pour ${pattern})`;
      }
      return truncateOutput(result.stdout, headLimit, outputMode);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("ENOENT"))) {
        throw err;
      }
      // Fallback : ripgrep pas installé → implémentation Node basique.
      return await fallbackGrep({
        pattern,
        searchPath,
        glob,
        outputMode,
        caseInsensitive,
        headLimit,
        ctx,
      });
    }
  },
};

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function truncateOutput(
  output: string,
  headLimit: number,
  mode: string,
): string {
  let text = output;
  if (text.length > MAX_OUTPUT_BYTES) {
    text = text.slice(0, MAX_OUTPUT_BYTES) + "\n… (sortie tronquée)";
  }
  const lines = text.split(/\r?\n/);
  if (mode === "content" || mode === "files_with_matches") {
    if (lines.length > headLimit) {
      return (
        lines.slice(0, headLimit).join("\n") +
        `\n… (${lines.length - headLimit} lignes tronquées)`
      );
    }
  }
  return text.trimEnd();
}

function runProcess(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT_BYTES * 2) child.kill();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) =>
      resolvePromise({ stdout, stderr, code: code ?? 0 }),
    );
  });
}

// Fallback : implémentation minimale via Node fs + regex.
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { ToolContext } from "./types.js";

interface FallbackOpts {
  pattern: string;
  searchPath: string;
  glob?: string;
  outputMode: string;
  caseInsensitive: boolean;
  headLimit: number;
  ctx: ToolContext;
}

const FALLBACK_IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  ".venv",
  "__pycache__",
]);

async function fallbackGrep(opts: FallbackOpts): Promise<string> {
  const flags = "m" + (opts.caseInsensitive ? "i" : "");
  let regex: RegExp;
  try {
    regex = new RegExp(opts.pattern, flags);
  } catch (err) {
    throw new Error(
      `Grep: regex invalide (${err instanceof Error ? err.message : err})`,
    );
  }
  const files: string[] = [];
  await collectFiles(opts.searchPath, opts.searchPath, files, opts.glob);

  const matches: string[] = [];
  const counts = new Map<string, number>();
  let fileCount = 0;

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    let fileMatches = 0;
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        fileMatches++;
        if (opts.outputMode === "content") {
          matches.push(`${file}:${i + 1}:${lines[i]}`);
          if (matches.length >= opts.headLimit) break;
        }
      }
    }
    if (fileMatches > 0) {
      fileCount++;
      if (opts.outputMode === "files_with_matches") {
        matches.push(file);
      } else if (opts.outputMode === "count") {
        counts.set(file, fileMatches);
      }
    }
    if (fileCount >= opts.headLimit && opts.outputMode !== "content") break;
  }

  if (opts.outputMode === "count") {
    const lines = [...counts.entries()].map(([f, n]) => `${f}:${n}`);
    return lines.length > 0 ? lines.join("\n") : `(aucun match)`;
  }
  return matches.length > 0 ? matches.join("\n") : `(aucun match)`;
}

async function collectFiles(
  root: string,
  current: string,
  out: string[],
  globPattern?: string,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    if (FALLBACK_IGNORED.has(entry.name)) continue;
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, full, out, globPattern);
    } else if (entry.isFile()) {
      if (globPattern) {
        const rel = relative(root, full).split(sep).join("/");
        if (!simpleGlobMatch(rel, globPattern)) continue;
      }
      out.push(full);
    }
  }
}

function simpleGlobMatch(path: string, pattern: string): boolean {
  // Match minimaliste : supporte * et **. Bien assez pour *.ts ou **/*.tsx.
  const regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp("^" + regex + "$").test(path);
}
