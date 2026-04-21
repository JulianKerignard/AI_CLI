import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

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
