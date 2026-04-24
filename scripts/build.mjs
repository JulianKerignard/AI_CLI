// Build esbuild : bundle tout le CLI en un seul fichier dist/index.js.
//
// Pourquoi bundler : chalk@5 (dep transitive de ink@7) utilise des subpath
// imports (#ansi-styles) qui cassent sur Windows Node 22 avec certains
// arbres node_modules nested. En bundlant, on élimine l'arbre de deps
// chez les users (plus de node_modules/@juliank./aicli/node_modules/ink/
// node_modules/chalk/…), donc plus aucune résolution runtime des imports.
//
// Approche adoptée par tsx, vitest, esbuild, prettier, @anthropic-ai/claude-code.

import { build } from "esbuild";
import {
  rmSync,
  mkdirSync,
  chmodSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const distDir = join(root, "dist");

// 1. Clean dist/
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// 2. Read version depuis package.json — injectée dans le bundle via --define,
//    permet à src/lib/update-check.ts de lire __AICLI_VERSION__ sans parser
//    un package.json qui, après bundling, n'est plus au path attendu.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;

// 3. Bundle ESM single-file.
//    - platform=node + format=esm : cible Node moderne, pas de CJS wrapper
//    - target=node18 : aligné avec "engines"
//    - banner.js=shebang : rend dist/index.js exécutable directement
//    - external: on garde yoga-wasm-web/yoga.wasm hors bundle car
//      c'est un binaire WASM chargé dynamiquement par ink (yoga-layout).
//      Les modules node: sont toujours external automatiquement.
//    - react-devtools-core est une peerDep optionnelle d'ink, jamais
//      chargée en prod mais peut planter le bundle si on l'inline.
console.log(`[build] esbuild bundle → dist/index.js (version ${version})`);
await build({
  entryPoints: [join(root, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: join(distDir, "index.js"),
  sourcemap: "external",
  banner: {
    // Le shebang de src/index.ts est préservé en ligne 1 par esbuild — on
    // ne le duplique PAS ici (sinon deuxième shebang en ligne 2 = syntax
    // error). createRequire injecté pour que les deps CJS bundlées qui
    // feraient `require(...)` dynamique ne plantent pas en ESM pure.
    js: `import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
`,
  },
  // react-devtools-core est une peerDep optionnelle d'ink, jamais chargée
  // en prod CLI. On l'alias vers un stub vide pour éviter ERR_MODULE_NOT_FOUND
  // au runtime et ne pas bundler 1+ MB de code DevTools inutile.
  alias: {
    "react-devtools-core": join(here, "stub-react-devtools.mjs"),
  },
  define: {
    // Version injectée au build-time. Remplace la lecture runtime de
    // package.json dans src/lib/update-check.ts::getLocalVersion().
    __AICLI_VERSION__: JSON.stringify(version),
  },
  // keepNames pour que les erreurs gardent les noms de fonctions
  // originaux dans les stack traces.
  keepNames: true,
  // Minification désactivée : on préfère un bundle lisible (debug) vs
  // gagner 30% de taille. Le fichier fait quelques MB au maximum.
  minify: false,
  // Log level concis pour ne pas spammer la CI.
  logLevel: "info",
  metafile: false,
});

// 4. Shebang exécutable sur Unix (ignoré sur Windows mais ne casse rien).
chmodSync(join(distDir, "index.js"), 0o755);

// 5. Écrire dist/.version (SHA git actuel, utilisé historiquement, gardé
//    pour compat avec d'éventuels callers). Version principale = __AICLI_VERSION__
//    injecté, mais le SHA git reste utile pour debug.
let sha = "unknown";
try {
  sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {
  const envSha = process.env.npm_package_gitHead;
  if (envSha) sha = envSha;
}
writeFileSync(join(distDir, ".version"), sha + "\n");

console.log(`[build] OK — dist/index.js + dist/.version (${sha.slice(0, 7)})`);
