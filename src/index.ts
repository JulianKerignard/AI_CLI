#!/usr/bin/env node
import { startRepl } from "./repl.js";
import { log } from "./utils/logger.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`aicli — CLI interactif à la Claude Code (mode démo)

Usage:
  aicli            lance le REPL
  aicli --version  affiche la version
  aicli --help     affiche cette aide

Dans le REPL :
  /help            liste des slash commands
  /tools           outils exposés à l'agent
  /skills          skills détectés (.aicli/skills/)
  /agents          sub-agents détectés (.aicli/agents/)
  /mcp             serveurs MCP connectés (.aicli/mcp.json)
  /clear           vide l'historique
  /exit            quitte
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log("0.1.0");
  process.exit(0);
}

startRepl().catch((err) => {
  log.error((err as Error).stack ?? (err as Error).message);
  process.exit(1);
});
