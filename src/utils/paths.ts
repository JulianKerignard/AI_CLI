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
