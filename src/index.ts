#!/usr/bin/env node
import { startRepl } from "./repl.js";
import { log } from "./utils/logger.js";
import { isValidMode } from "./permissions/policy.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`aicli — CLI interactif à la Claude Code

Usage:
  aicli                    lance le REPL
  aicli --mode=<name>      force un mode de permissions pour cette session
                           (default | accept-edits | bypass | plan)
  aicli --version          affiche la version
  aicli --help             affiche cette aide

Environnement :
  AICLI_AUTH_TOKEN         token API (csm_…) — override fichier credentials
  AICLI_BASE_URL           https://chat.juliankerignard.fr/api par défaut
  AICLI_MODEL              mistral-large-latest par défaut
  AICLI_MODE               mode permissions (idem --mode=)

Dans le REPL :
  /help                    liste des slash commands
  /login  /logout  /status gère la connexion API
  /tools                   outils exposés à l'agent
  /skills  /agents  /mcp   ressources chargées
  /usage  /tokens          tokens session + quota restant
  /permissions             gère les modes et allowlists
  /clear                   vide l'historique
  /exit                    quitte

Modes permissions :
  default                  demande pour Write/Edit/Bash, auto pour lecture
  accept-edits             auto Write/Edit, demande Bash
  bypass                   auto pour tout (dangereux — CI / sandbox uniquement)
  plan                     read-only (refuse Write/Edit/Bash)
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log("0.1.0");
  process.exit(0);
}

// --mode=<name> → AICLI_MODE pour que loadPermissions() le prenne en compte.
const modeArg = args.find((a) => a.startsWith("--mode="));
if (modeArg) {
  const value = modeArg.slice("--mode=".length);
  if (!isValidMode(value)) {
    log.error(
      `Mode invalide: ${value}. Valeurs: default, accept-edits, bypass, plan.`,
    );
    process.exit(1);
  }
  process.env.AICLI_MODE = value;
}

startRepl().catch((err) => {
  log.error((err as Error).stack ?? (err as Error).message);
  process.exit(1);
});
