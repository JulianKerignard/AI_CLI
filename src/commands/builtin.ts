import type { SlashCommand } from "./types.js";
import { log, chalk, formatQuotaStatus } from "../utils/logger.js";
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
          console.log(
            "  " +
              log.accent.bold("/" + c.name.padEnd(12)) +
              log.inkMuted(c.description),
          );
        }
        console.log();
        log.faint(
          "Tape du texte libre pour parler à l'agent. Ctrl-D ou /exit pour quitter.",
        );
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
      name: "usage",
      description: "Affiche tokens session + quota restant.",
      async run({ agent }) {
        const stats = agent.getStats();
        log.banner("Usage");
        const lines = formatQuotaStatus(stats, stats.lastQuota);
        for (const l of lines) console.log(l);
        console.log();
      },
    },
    {
      name: "tokens",
      description: "Alias de /usage.",
      async run({ agent }) {
        const stats = agent.getStats();
        log.banner("Usage");
        const lines = formatQuotaStatus(stats, stats.lastQuota);
        for (const l of lines) console.log(l);
        console.log();
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
          console.log(
            "  " +
              log.accentSoft(t.name.padEnd(22)) +
              log.inkMuted(t.description),
          );
        }
      },
    },
    {
      name: "skills",
      description: "Liste les skills détectés dans .aicli/skills/.",
      async run({ skills }) {
        log.banner("Skills");
        if (skills.length === 0) {
          log.faint("  (aucun)");
          return;
        }
        for (const s of skills) {
          console.log(
            "  " +
              log.accent(s.name.padEnd(18)) +
              log.inkMuted(s.description),
          );
        }
      },
    },
    {
      name: "agents",
      description: "Liste les sub-agents détectés dans .aicli/agents/.",
      async run({ subAgents }) {
        log.banner("Sub-agents");
        if (subAgents.length === 0) {
          log.faint("  (aucun)");
          return;
        }
        for (const a of subAgents) {
          console.log(
            "  " +
              log.accentSoft(a.name.padEnd(18)) +
              log.inkMuted(a.description),
          );
          if (a.tools) log.faint(`    tools: ${a.tools.join(", ")}`);
        }
      },
    },
    {
      name: "mcp",
      description: "Liste les serveurs MCP connectés.",
      async run({ mcpServers }) {
        log.banner("Serveurs MCP");
        if (mcpServers.length === 0) {
          log.faint("  (aucun — crée .aicli/mcp.json pour en configurer)");
          return;
        }
        for (const s of mcpServers) {
          console.log(
            "  " +
              log.accent(s.name.padEnd(14)) +
              log.inkMuted(s.status),
          );
          for (const t of s.tools) log.faint(`    ↳ ${t.name}`);
        }
      },
    },
  ];
}
