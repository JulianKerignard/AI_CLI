import { CWD } from "./utils/paths.js";
import { log } from "./utils/logger.js";
import { promptLine } from "./repl-prompt.js";
import { InputHistory } from "./utils/history.js";
import { createBaseRegistry } from "./tools/registry.js";
import { DemoProvider } from "./agent/demo-provider.js";
import { HttpProvider } from "./agent/http-provider.js";
import { AgentLoop } from "./agent/loop.js";
import { CommandRegistry } from "./commands/registry.js";
import { loadSkills } from "./skills/loader.js";
import { makeSkillTool } from "./skills/tool.js";
import { loadSubAgents } from "./agents/loader.js";
import { makeAgentTool } from "./agents/tool.js";
import { loadMcpServers } from "./mcp/config.js";
import {
  loadCredentials,
  checkCredentialsPerms,
  type Credentials,
} from "./auth/store.js";
import type { Provider } from "./agent/provider.js";
import {
  loadPermissions,
  savePermissions,
  type PermissionsConfig,
} from "./permissions/store.js";
import type {
  PermissionMode,
  PolicyState,
} from "./permissions/policy.js";
import {
  initStatusBar,
  teardownStatusBar,
  updateStatus,
  hideStatus,
  showStatus,
} from "./utils/status-bar.js";

function buildSystemPrompt(cwd: string): string {
  return `Tu es AI_CLI, un agent de code qui tourne dans un terminal, inspiré de Claude Code.

# Contexte d'exécution
Tu tournes DANS le répertoire de l'utilisateur : ${cwd}
C'est ton répertoire de travail courant. Tu n'as pas besoin de demander où est le projet — tu y es déjà.

# Ton rôle
Assistant de développement logiciel. Tu aides l'utilisateur à écrire, lire, modifier, debugger, exécuter du code. Tu as accès à des outils (Read, Write, Bash, Skill, Agent, mcp__*) que tu appelles directement via tool_use. JAMAIS de pseudo-code markdown qui simule un appel d'outil (\`<function>Bash</function>\`, \`\`\`bash etc.) — soit tu appelles l'outil réellement, soit tu réponds en texte.

# Comportement
- Action d'abord : pas de "je vais analyser", "je commence par...". Appelle directement les outils qu'il faut.
- Pas de questions inutiles : si l'utilisateur dit "analyse le projet", tu lances \`ls -la\` + \`cat package.json\` (ou équivalent) sans demander.
- Concis : réponds court et direct. Pas de préambule, pas de résumé final, pas d'emojis sauf demande explicite.
- Français par défaut, termes techniques en anglais.
- Si une commande échoue, investigue (lis l'erreur, lis le fichier concerné) avant de proposer un fix.
- Pour tout changement non-trivial sur du code existant, lis d'abord le fichier avant d'éditer.

# Outils disponibles
Utilise-les via des vrais tool_use blocks (pas du texte). Liste :
- **Read** : lit un fichier (numéroté, utile pour localiser les lignes à éditer ensuite)
- **Write** : crée ou écrase un fichier (privilégie Edit pour modifier l'existant)
- **Edit** : remplace une chaîne exacte dans un fichier (plus sûr que Write sur de l'existant)
- **Glob** : trouve des fichiers par pattern ('**/*.ts', 'src/**/*.{ts,tsx}'), triés par date
- **Grep** : cherche un regex dans les fichiers (utilise ripgrep si dispo)
- **Ls** : liste un répertoire (taille + type)
- **Bash** : exécute une commande shell (\`npm test\`, \`git status\`, build, etc.)
- **Skill/Agent** : délègue à un skill ou sub-agent configuré

Workflow typique sur une tâche :
1. Ls ou Glob pour localiser les fichiers
2. Read pour lire le fichier concerné
3. Edit (ou Write pour un nouveau) pour la modification
4. Bash pour tester (\`npm run build\`, \`npm test\`, etc.)

# Parallélisation des tools (IMPORTANT)
Quand plusieurs actions sont indépendantes, émets TOUS les tool_use dans la MÊME
réponse au lieu de les faire un par un. Exemples :
- Explorer un projet : 1 seul turn avec Ls("src") + Ls("tests") + Read("package.json") + Read("README.md") en parallèle
- Lire plusieurs fichiers liés : tous les Read en même temps
- Cherche dans plusieurs dossiers : Glob x3 dans le même turn
Ne fais séquentiel QUE si l'action N dépend du résultat de l'action N-1 (ex: Ls
d'abord pour découvrir les fichiers, puis Read ensuite). Chaque turn sans
parallélisation = 1 requête Mistral de plus vers un rate limit bas.

# Style de code
Conventions standard : code propre, noms explicites, pas de commentaires triviaux. Respecte le style existant du projet (lis quelques fichiers avant d'écrire pour capter les conventions).`;
}

function makeProvider(creds: Credentials | null): Provider {
  if (creds) {
    return new HttpProvider({
      token: creds.token,
      baseUrl: creds.baseUrl,
      model: creds.model,
    });
  }
  return new DemoProvider();
}

export async function startRepl(): Promise<void> {
  const tools = createBaseRegistry();

  let currentCreds = loadCredentials();
  const permCheck = checkCredentialsPerms();
  if (!permCheck.ok && permCheck.warning) log.warn(permCheck.warning);

  let provider = makeProvider(currentCreds);

  // Permissions : config persistante + état session mutable.
  let permConfig: PermissionsConfig = loadPermissions();
  const sessionAllowed = new Set<string>();

  const getPolicyState = (): PolicyState => ({
    mode: permConfig.mode,
    sessionAllowed,
    alwaysAllow: new Set(permConfig.alwaysAllow),
  });

  const agent = new AgentLoop({
    system: buildSystemPrompt(CWD),
    provider,
    tools,
    cwd: CWD,
    getPolicyState,
    onAllowSession: (toolName) => {
      sessionAllowed.add(toolName);
    },
    onAllowPersist: (toolName) => {
      if (!permConfig.alwaysAllow.includes(toolName)) {
        permConfig = {
          ...permConfig,
          alwaysAllow: [...permConfig.alwaysAllow, toolName],
        };
        savePermissions(permConfig);
      }
    },
  });

  const skills = loadSkills();
  const subAgents = loadSubAgents();

  tools.register(makeSkillTool(skills, agent));
  // makeAgentTool reçoit la référence du provider courant ; on le recrée
  // lors du switch /login /logout pour qu'il voie le bon provider.
  const registerAgentTool = () => {
    tools.register(makeAgentTool({ subAgents, provider, parentTools: tools }));
  };
  registerAgentTool();

  const mcpServers = await loadMcpServers(tools);

  const commands = new CommandRegistry();

  // initStatusBar enregistre les handlers SIGINT/SIGTERM — OK d'appeler
  // avant le banner. Mais on DIFFÈRE updateStatus (qui déclenche le premier
  // render) jusqu'APRÈS le banner, sinon le status s'imprime en haut puis
  // le banner passe par-dessus et on voit le status deux fois.
  initStatusBar();

  log.banner("AI_CLI v0.1.0");
  console.log(
    "  " +
      log.kicker("provider") +
      "  " +
      log.ink(provider.name) +
      "   " +
      log.kicker("cwd") +
      "  " +
      log.inkMuted(CWD),
  );
  console.log(
    "  " +
      log.kicker("loaded") +
      "  " +
      log.inkMuted(
        `${tools.list().length} tools · ${skills.length} skills · ${subAgents.length} agents · ${mcpServers.length} MCP`,
      ),
  );
  // Warning explicite si mode bypass (visible dès le démarrage).
  const modeDisplay =
    permConfig.mode === "bypass"
      ? log.danger("⚠ " + permConfig.mode)
      : permConfig.mode === "plan"
        ? log.accentSoft(permConfig.mode)
        : log.ink(permConfig.mode);
  console.log("  " + log.kicker("mode") + "      " + modeDisplay);
  console.log();
  if (!currentCreds) {
    console.log(
      "  " +
        log.accentSoft("→") +
        "  tape " +
        log.accent.bold("/login") +
        log.inkMuted(" pour te connecter à chat.juliankerignard.fr"),
    );
  }
  console.log(
    "  " +
      log.inkFaint("→") +
      "  " +
      log.inkMuted("tape ") +
      log.accent.bold("/help") +
      log.inkMuted(" pour les commandes, ") +
      log.accent.bold("Ctrl-D") +
      log.inkMuted(" pour quitter"),
  );
  console.log();

  // Premier render du status APRÈS le banner pour qu'il s'affiche en bas
  // (et pas en double : une fois avant, une fois après).
  updateStatus({
    provider: provider.name,
    phase: currentCreds ? "idle" : "offline",
  });

  // Boucle principale entièrement via @inquirer/input — plus de readline
  // parallèle, plus de collision stdin. L'historique ↑↓ est géré en mode
  // append-only (pas de navigation pour l'instant ; V2).
  const history = new InputHistory();

  const cleanup = () => {
    teardownStatusBar();
    for (const s of mcpServers) s.close();
  };

  let shouldExit = false;
  const exit = () => {
    shouldExit = true;
    cleanup();
    log.info("Au revoir.");
    process.exit(0);
  };

  const auth = {
    getCredentials: () => currentCreds,
    onLogin: (creds: Credentials) => {
      currentCreds = creds;
      provider = makeProvider(creds);
      agent.setProvider(provider);
      registerAgentTool();
    },
    onLogout: () => {
      currentCreds = null;
      provider = makeProvider(null);
      agent.setProvider(provider);
      registerAgentTool();
    },
  };

  const permissions = {
    getMode: () => permConfig.mode,
    setMode: (mode: PermissionMode, persist = true) => {
      permConfig = { ...permConfig, mode };
      if (persist) savePermissions(permConfig);
    },
    getAlwaysAllow: () => [...permConfig.alwaysAllow],
    addAlwaysAllow: (toolName: string) => {
      if (!permConfig.alwaysAllow.includes(toolName)) {
        permConfig = {
          ...permConfig,
          alwaysAllow: [...permConfig.alwaysAllow, toolName],
        };
        savePermissions(permConfig);
      }
    },
    removeAlwaysAllow: (toolName: string) => {
      permConfig = {
        ...permConfig,
        alwaysAllow: permConfig.alwaysAllow.filter((t) => t !== toolName),
      };
      savePermissions(permConfig);
    },
    getSessionAllowed: () => [...sessionAllowed],
    clearSessionAllowed: () => {
      sessionAllowed.clear();
    },
  };

  // Boucle REPL : un seul owner de stdin à tout moment (inquirer), donc
  // pas de collision quand /model ouvre son propre picker inquirer.
  let ctrlCCount = 0;
  let ctrlCResetTimer: NodeJS.Timeout | null = null;

  while (!shouldExit) {
    let input: string;
    try {
      input = (await promptLine()).trim();
    } catch (err) {
      // ExitPromptError (Ctrl-C dans inquirer) ou Ctrl-D (stdin EOF) →
      // soft cancel. Double occurrence dans 1.5s = exit propre.
      const msg = err instanceof Error ? err.message : String(err);
      const isExitPrompt =
        (err as { name?: string })?.name === "ExitPromptError" ||
        /user force closed|canceled/i.test(msg);
      if (!isExitPrompt) {
        log.error(msg);
        continue;
      }
      ctrlCCount += 1;
      if (ctrlCCount >= 2) {
        exit();
        return;
      }
      console.log(log.inkMuted("  (Ctrl-C encore pour quitter, ou /exit)"));
      if (ctrlCResetTimer) clearTimeout(ctrlCResetTimer);
      ctrlCResetTimer = setTimeout(() => {
        ctrlCCount = 0;
      }, 1500);
      continue;
    }
    // Input reçu → reset le compteur Ctrl-C.
    ctrlCCount = 0;
    if (ctrlCResetTimer) {
      clearTimeout(ctrlCResetTimer);
      ctrlCResetTimer = null;
    }

    hideStatus();
    if (!input) {
      showStatus();
      continue;
    }
    history.add(input);

    try {
      if (input.startsWith("/")) {
        await commands.run(input, {
          agent,
          tools,
          skills,
          subAgents,
          mcpServers,
          auth,
          permissions,
          exit,
        });
      } else {
        await agent.send(input);
      }
    } catch (err) {
      log.error((err as Error).message);
    }

    if (shouldExit) return;
    showStatus();
  }
}
