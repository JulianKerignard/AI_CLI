import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

// Lit la branche git courante sans dépendance (pas de `git` subprocess
// si on peut éviter). Parcours les parents jusqu'à trouver un .git.

function findGitDir(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 100; i++) {
    const candidate = join(dir, ".git");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export interface GitInfo {
  branch: string | null;
  repoRoot: string | null;
  additions: number;
  deletions: number;
  dirty: boolean;
}

// Cache plus agressif sur Windows : git.exe en PATH peut ajouter 200-500ms
// par invocation si pas warm (Windows Defender scan). 60s évite de re-spawn.
const CACHE_TTL_MS = process.platform === "win32" ? 60_000 : 10_000;
let cached: { at: number; cwd: string; info: GitInfo } | null = null;

export function getGitInfo(cwd: string): GitInfo {
  const now = Date.now();
  if (cached && cached.cwd === cwd && now - cached.at < CACHE_TTL_MS) {
    return cached.info;
  }

  const info: GitInfo = {
    branch: null,
    repoRoot: null,
    additions: 0,
    deletions: 0,
    dirty: false,
  };

  const gitDir = findGitDir(cwd);
  if (!gitDir) {
    cached = { at: now, cwd, info };
    return info;
  }
  info.repoRoot = dirname(gitDir);

  // Parse .git/HEAD pour branche courante (évite un subprocess).
  try {
    const headPath = join(gitDir, "HEAD");
    if (existsSync(headPath) && statSync(headPath).isFile()) {
      const head = readFileSync(headPath, "utf8").trim();
      const m = /^ref:\s+refs\/heads\/(.+)$/.exec(head);
      info.branch = m ? m[1] : head.slice(0, 7); // detached → short SHA
    }
  } catch {
    /* ignore */
  }

  // Diff stat via subprocess : rapide (<30ms) et précis. Sync OK, 1x par 10s.
  try {
    const proc = spawnSync("git", ["diff", "--numstat", "HEAD"], {
      cwd: info.repoRoot,
      // Windows : git.exe peut être lent au premier call (Defender scan).
      // 300ms suffit si warm, cache à 60s absorbe les premiers spawns.
      timeout: process.platform === "win32" ? 300 : 500,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (proc.error) {
      return info;
    }
    if (proc.status === 0 && proc.stdout) {
      const lines = proc.stdout.trim().split("\n").filter(Boolean);
      for (const l of lines) {
        const parts = l.split(/\s+/);
        const add = Number(parts[0]);
        const del = Number(parts[1]);
        if (Number.isFinite(add)) info.additions += add;
        if (Number.isFinite(del)) info.deletions += del;
      }
      info.dirty = lines.length > 0;
    }
  } catch {
    /* ignore */
  }

  cached = { at: now, cwd, info };
  return info;
}

