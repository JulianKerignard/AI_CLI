import type { SlashCommand } from "./types.js";
import { log, chalk, formatQuotaStatus } from "../utils/logger.js";
import { runLoginFlow } from "../auth/login.js";
import { clearCredentials } from "../auth/store.js";
import {
  isValidMode,
  modeLabel,
  categorize,
  type PermissionMode,
} from "../permissions/policy.js";

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
      name: "permissions",
      description:
        "Gère les permissions. /permissions [mode <name>|allow <tool>|revoke <tool>|reset]",
      async run({ permissions }, args) {
        const parts = args.trim().split(/\s+/).filter(Boolean);
        const sub = parts[0];

        if (!sub || sub === "status") {
          log.banner("Permissions");
          const mode = permissions.getMode();
          console.log(
            "  " +
              log.inkMuted.bold("MODE     ") +
              "  " +
              (mode === "bypass"
                ? log.danger(modeLabel(mode))
                : mode === "plan"
                  ? log.accentSoft(modeLabel(mode))
                  : log.ink(modeLabel(mode))),
          );
          const persistent = permissions.getAlwaysAllow();
          console.log(
            "  " +
              log.inkMuted.bold("ALWAYS   ") +
              "  " +
              (persistent.length === 0
                ? log.inkMuted("(aucun)")
                : persistent
                    .map((t) => log.accent(t))
                    .join(log.inkMuted(", "))),
          );
          const session = permissions.getSessionAllowed();
          console.log(
            "  " +
              log.inkMuted.bold("SESSION  ") +
              "  " +
              (session.length === 0
                ? log.inkMuted("(aucun)")
                : session
                    .map((t) => log.accentSoft(t))
                    .join(log.inkMuted(", "))),
          );
          console.log();
          log.faint("Modes : default · accept-edits · bypass · plan");
          log.faint(
            "Ex: /permissions mode accept-edits, /permissions allow Bash, /permissions reset",
          );
          return;
        }

        if (sub === "mode") {
          const target = parts[1];
          if (!target || !isValidMode(target)) {
            log.error(
              "Mode invalide. Valeurs possibles : default, accept-edits, bypass, plan.",
            );
            return;
          }
          permissions.setMode(target as PermissionMode, true);
          log.info(`Mode → ${modeLabel(target as PermissionMode)} (persisté)`);
          if (target === "bypass") {
            log.warn(
              "⚠ mode bypass — tous les tools sont auto-acceptés. Utilise /permissions mode default pour revenir.",
            );
          }
          return;
        }

        if (sub === "allow") {
          const tool = parts[1];
          if (!tool) {
            log.error("Usage : /permissions allow <ToolName>");
            return;
          }
          permissions.addAlwaysAllow(tool);
          log.info(`${tool} auto-autorisé (persisté · catégorie ${categorize(tool)})`);
          return;
        }

        if (sub === "revoke" || sub === "deny") {
          const tool = parts[1];
          if (!tool) {
            log.error("Usage : /permissions revoke <ToolName>");
            return;
          }
          permissions.removeAlwaysAllow(tool);
          log.info(`${tool} retiré de la liste d'auto-allow.`);
          return;
        }

        if (sub === "reset") {
          permissions.clearSessionAllowed();
          log.info("Allowlist de session vidée.");
          return;
        }

        log.error(
          "Sous-commande inconnue. Usage : /permissions [status|mode <name>|allow <tool>|revoke <tool>|reset]",
        );
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
