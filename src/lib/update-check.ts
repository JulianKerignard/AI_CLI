import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// Version injectée au build-time par esbuild (--define:__AICLI_VERSION__).
// Fallback lecture package.json pour le dev runtime (tsx src/index.ts) où
// esbuild ne tourne pas. La const doit rester simple (sans destructuring,
// sans template string) pour que esbuild puisse la remplacer littéralement.
declare const __AICLI_VERSION__: string | undefined;

// Update checker version-based : détecte le canal depuis la version locale
// (prerelease `-dev.` → canal dev, sinon latest) et compare aux dist-tags
// publiés sur npm. Évite de dériver sur des SHAs git qui ne correspondent
// pas forcément à ce qui est réellement sur npm.

const PACKAGE_NAME = "@juliank./aicli";
// npm registry encode le `/` du scope en `%2F` dans l'URL.
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME.replace("/", "%2F")}`;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_FILE = join(homedir(), ".aicli", "update-cache.json");
const TIMEOUT_MS = 5_000;

export type Channel = "dev" | "latest";

export interface UpdateStatus {
  current: string;
  latest: string | null;
  channel: Channel;
  updateAvailable: boolean;
  checkedAt: number;
}

// Version : priorité à __AICLI_VERSION__ injecté au build (esbuild --define),
// sinon fallback lecture package.json pour le mode dev (tsx src/index.ts).
// Après bundling, le ternaire est réduit par esbuild à la constante — pas
// de fs call au runtime.
export function getLocalVersion(): string {
  if (
    typeof __AICLI_VERSION__ !== "undefined" &&
    __AICLI_VERSION__ !== ""
  ) {
    return __AICLI_VERSION__;
  }
  // Dev fallback : on lit package.json depuis la racine du projet via
  // import.meta.url. Path source (tsx) : src/lib/update-check.ts →
  // ../../package.json. Path dist historique (non-bundled) : idem.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const rel of ["../../package.json", "../package.json"]) {
      const pkgFile = join(here, rel);
      if (existsSync(pkgFile)) {
        const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as {
          version?: string;
        };
        if (typeof pkg.version === "string") return pkg.version;
      }
    }
  } catch {
    /* ignore */
  }
  return "unknown";
}

// Semver prerelease = canal dev. Match `-dev.N`, `-alpha`, `-beta`, `-rc.N`, `-next`.
// Une release stable (0.1.0, 1.2.3) → latest.
export function detectChannel(version: string): Channel {
  return /-(?:dev|alpha|beta|rc|next)\b/i.test(version) ? "dev" : "latest";
}

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

// Fetch des dist-tags du registry npm. Retourne `{ latest, dev, ... }` ou null.
async function fetchDistTags(
  signal?: AbortSignal,
): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { "User-Agent": "aicli-update-check" },
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { "dist-tags"?: Record<string, string> };
    return data["dist-tags"] ?? null;
  } catch {
    return null;
  }
}

// Check principal : lit cache, sinon fetch. Non-bloquant — échec = no-op.
export async function checkForUpdate(
  force = false,
): Promise<UpdateStatus | null> {
  const current = getLocalVersion();
  if (current === "unknown") return null;
  const channel = detectChannel(current);

  if (!force) {
    const cached = readCache();
    if (cached && cached.current === current && cached.channel === channel)
      return cached;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const tags = await fetchDistTags(ctrl.signal);
  clearTimeout(timer);
  if (!tags) return null;

  const latest = tags[channel] ?? null;
  const status: UpdateStatus = {
    current,
    latest,
    channel,
    updateAvailable: latest !== null && latest !== current,
    checkedAt: Date.now(),
  };
  writeCache(status);
  return status;
}

// URL npm pour voir le détail des versions / le README publié.
export function npmInfoUrl(): string {
  return `https://www.npmjs.com/package/${PACKAGE_NAME}?activeTab=versions`;
}
