// Écrit le SHA git courant dans dist/.version. Lancé en postbuild
// + pendant npm install -g (via le script 'prepare' → postbuild).
//
// Si le repo n'a pas .git (cas npm install depuis tarball), on essaie
// de lire npm_package_gitHead, sinon on marque 'unknown'.

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const versionFile = join(distDir, ".version");

let sha = "unknown";

// 1. Essaie git rev-parse.
try {
  sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {
  // 2. Fallback : npm_package_gitHead (dispo quand npm install depuis tarball
  //    GitHub, qui embed le SHA dans package.json ou via npm métadonnées).
  const envSha = process.env.npm_package_gitHead;
  if (envSha) sha = envSha;
}

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
writeFileSync(versionFile, sha + "\n");
console.log(`[set-version] dist/.version = ${sha}`);
