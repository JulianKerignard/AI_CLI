import type { SlashCommand } from "./types.js";
import { log, chalk } from "../utils/logger.js";
import { runLoginFlow } from "../auth/login.js";
import { clearCredentials } from "../auth/store.js";

export function builtinCommands(allCommands: () => SlashCommand[]): SlashCommand[] {
  return [
    {
      name: "help",
      description: "Affiche la liste des commandes disponibles.",
      async run() {
        log.banner("Commandes disponibles");
        for (const c of allCommands()) {
          console.log(`  ${chalk.bold("/" + c.name.padEnd(12))} ${chalk.gray(c.description)}`);
        }
        console.log();
        log.dim("Tape du texte libre pour parler à l'agent. Ctrl-D ou /exit pour quitter.");
      },
    },
    {
      name: "clear",
      description: "Réinitialise l'historique de conversation.",
      async run({ agent }) {
        agent.reset();
        log.info("Historique effacé.");
      },
    },
    {
      name: "login",
      description: "Se connecter à chat.juliankerignard.fr (flow navigateur).",
      async run({ auth }) {
        try {
          const creds = await runLoginFlow();
          auth.onLogin(creds);
          log.info(
            `Connecté. Provider basculé sur ${creds.baseUrl} (model: ${creds.model}).`,
          );
        } catch (err) {
          log.error(`Login échoué : ${err instanceof Error ? err.message : err}`);
        }
      },
    },
    {
      name: "logout",
      description: "Supprime le token local et revient au provider démo.",
      async run({ auth }) {
        clearCredentials();
        auth.onLogout();
        log.info("Déconnecté. Retour au provider démo.");
      },
    },
    {
      name: "status",
      description: "Affiche l'état d'authentification.",
      async run({ auth }) {
        const creds = auth.getCredentials();
        if (creds) {
          log.info(`Connecté à ${creds.baseUrl}`);
          log.info(`Token  : ${creds.token.slice(0, 8)}… (masqué)`);
          log.info(`Model  : ${creds.model}`);
        } else {
          log.info("Non connecté. Tape /login pour te connecter.");
        }
      },
    },
    {
      name: "exit",
      description: "Quitte le CLI.",
      async run({ exit }) {
        exit();
      },
    },
    {
      name: "tools",
      description: "Liste les outils exposés à l'agent.",
      async run({ tools }) {
        log.banner("Outils");
        for (const t of tools.list()) {
          console.log(`  ${chalk.magenta(t.name.padEnd(22))} ${chalk.gray(t.description)}`);
        }
      },
    },
    {
      name: "skills",
      description: "Liste les skills détectés dans .aicli/skills/.",
      async run({ skills }) {
        log.banner("Skills");
        if (skills.length === 0) {
          log.dim("  (aucun)");
          return;
        }
        for (const s of skills) {
          console.log(`  ${chalk.cyan(s.name.padEnd(18))} ${chalk.gray(s.description)}`);
        }
      },
    },
    {
      name: "agents",
      description: "Liste les sub-agents détectés dans .aicli/agents/.",
      async run({ subAgents }) {
        log.banner("Sub-agents");
        if (subAgents.length === 0) {
          log.dim("  (aucun)");
          return;
        }
        for (const a of subAgents) {
          console.log(`  ${chalk.yellow(a.name.padEnd(18))} ${chalk.gray(a.description)}`);
          if (a.tools) log.dim(`    tools: ${a.tools.join(", ")}`);
        }
      },
    },
    {
      name: "mcp",
      description: "Liste les serveurs MCP connectés.",
      async run({ mcpServers }) {
        log.banner("Serveurs MCP");
        if (mcpServers.length === 0) {
          log.dim("  (aucun — crée .aicli/mcp.json pour en configurer)");
          return;
        }
        for (const s of mcpServers) {
          console.log(`  ${chalk.blue(s.name.padEnd(14))} ${chalk.gray(s.status)}`);
          for (const t of s.tools) log.dim(`    ↳ ${t.name}`);
        }
      },
    },
  ];
}
