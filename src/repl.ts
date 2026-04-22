import readline from "node:readline";
import { CWD } from "./utils/paths.js";
import { log, chalk } from "./utils/logger.js";
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
Utilise-les via des vrais tool_use blocks (pas du texte). Exemples typiques :
- Read pour lire un fichier
- Bash pour exécuter une commande shell (\`ls\`, \`npm test\`, \`git status\`, etc.)
- Write pour créer/modifier un fichier (privilégie Read puis patch quand le fichier existe)
- Skill/Agent pour déléguer à un skill ou sub-agent configuré

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

  const agent = new AgentLoop({
    system: buildSystemPrompt(CWD),
    provider,
    tools,
    cwd: CWD,
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

  log.banner("AI_CLI v0.1.0");
  log.dim(`  provider: ${provider.name}  ·  cwd: ${CWD}`);
  log.dim(
    `  ${tools.list().length} outils  ·  ${skills.length} skills  ·  ${subAgents.length} sub-agents  ·  ${mcpServers.length} MCP`,
  );
  if (!currentCreds) {
    log.dim("  Tape /login pour te connecter à chat.juliankerignard.fr.");
  }
  log.dim("  Tape /help pour les commandes. Ctrl-D ou /exit pour quitter.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.blue("» "),
  });

  const cleanup = () => {
    for (const s of mcpServers) s.close();
    rl.close();
  };

  let shouldExit = false;
  const exit = () => {
    shouldExit = true;
    cleanup();
    log.info("Au revoir.");
    process.exit(0);
  };

  rl.on("close", () => {
    if (!shouldExit) {
      cleanup();
      console.log();
      log.info("Au revoir.");
    }
  });

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

  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }

    try {
      if (input.startsWith("/")) {
        await commands.run(input, {
          agent,
          tools,
          skills,
          subAgents,
          mcpServers,
          auth,
          exit,
        });
      } else {
        await agent.send(input);
      }
    } catch (err) {
      log.error((err as Error).message);
    }

    if (shouldExit) return;
    rl.prompt();
  }
}
