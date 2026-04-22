import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// Update checker : compare le commit SHA local (écrit au build dans
// dist/.version) avec le SHA HEAD du repo GitHub. Silencieux, best-effort.
// Cache 6h dans ~/.aicli/update-cache.json pour ne pas spammer GitHub API.

const REPO_OWNER = "JulianKerignard";
const REPO_NAME = "AI_CLI";
const BRANCH = "main";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_FILE = join(homedir(), ".aicli", "update-cache.json");
const TIMEOUT_MS = 5_000;

export interface UpdateStatus {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: number;
}

// Lit le SHA local écrit par scripts/set-version.mjs au build.
export function getLocalSha(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/lib/update-check.js → dist/.version
    const versionFile = join(here, "..", ".version");
    if (existsSync(versionFile)) {
      return readFileSync(versionFile, "utf8").trim();
    }
  } catch {
    /* ignore */
  }
  return "unknown";
}

// Cache read.
function readCache(): UpdateStatus | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const raw = readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as UpdateStatus;
    if (Date.now() - parsed.checkedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(status: UpdateStatus): void {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(status, null, 2));
  } catch {
    /* ignore */
  }
}

// Fetch silencieux du dernier commit SHA. Retourne null si erreur.
async function fetchLatestSha(signal?: AbortSignal): Promise<string | null> {
  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${BRANCH}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "aicli-update-check",
      },
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { sha?: string };
    return typeof data.sha === "string" ? data.sha : null;
  } catch {
    return null;
  }
}

// Check principal : lit cache, sinon fetch. Non-bloquant — échec = no-op.
export async function checkForUpdate(force = false): Promise<UpdateStatus | null> {
  const current = getLocalSha();
  if (current === "unknown") return null;

  if (!force) {
    const cached = readCache();
    if (cached && cached.current === current) return cached;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const latest = await fetchLatestSha(ctrl.signal);
  clearTimeout(timer);
  if (!latest) return null;

  const status: UpdateStatus = {
    current,
    latest,
    updateAvailable: !latest.startsWith(current) && !current.startsWith(latest),
    checkedAt: Date.now(),
  };
  writeCache(status);
  return status;
}

// URL de comparaison GitHub pour que l'user voie le diff.
export function compareUrl(current: string, latest: string): string {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/compare/${current.slice(0, 12)}...${latest.slice(0, 12)}`;
}
