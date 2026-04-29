import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CWD = process.cwd();
export const PROJECT_AICLI = join(CWD, ".aicli");
export const USER_AICLI = join(homedir(), ".aicli");

export function aicliDirs(): string[] {
  const dirs: string[] = [];
  if (existsSync(PROJECT_AICLI)) dirs.push(PROJECT_AICLI);
  if (existsSync(USER_AICLI) && USER_AICLI !== PROJECT_AICLI)
    dirs.push(USER_AICLI);
  return dirs;
}

export function subdirs(name: string): string[] {
  return aicliDirs()
    .map((d) => join(d, name))
    .filter(existsSync);
}

// Raccourcit un chemin pour affichage : remplace $HOME par ~, et le cwd
// courant par '.'. Utilisé par les formatInvocation des tools (Read,
// Write, Edit) pour que '◆ Read(/Users/me/projets/foo/src/x.ts)' ne soit
// pas une ligne entière. Sortie typique : '~/projets/foo/src/x.ts' ou
// './src/x.ts'. Si le path n'est ni dans home ni dans cwd, retourné tel
// quel (paths absolus système comme /etc/hosts restent visibles).
export function shortPath(p: string): string {
  if (!p) return "";
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (p.startsWith(CWD + "/") || p === CWD) {
    const rest = p.slice(CWD.length);
    return rest.length === 0 ? "." : "." + rest;
  }
  if (home && (p.startsWith(home + "/") || p === home)) {
    return "~" + p.slice(home.length);
  }
  return p;
}

// Lit la version depuis le package.json. Tente plusieurs paths pour
// couvrir le mode dev (src/utils/paths.ts → ../../package.json) et le
// mode bundle esbuild (dist/index.js → ../package.json). Sans ça,
// /about affiche '?' quand on est en bundle prod.
let cachedVersion: string | undefined;
export function getAppVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(here, rel), "utf8"));
      if (typeof pkg.version === "string") {
        cachedVersion = pkg.version as string;
        return cachedVersion;
      }
    } catch {
      // try next path
    }
  }
  cachedVersion = "?";
  return cachedVersion;
}
