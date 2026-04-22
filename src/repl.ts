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

const SYSTEM_PROMPT = `Tu es AI_CLI, un assistant CLI local inspiré de Claude Code.
Tu disposes d'outils (Read, Write, Bash, Skill, Agent, mcp__*) pour accomplir des tâches.
Réponds en français, sois concis, et utilise les outils quand c'est utile.`;

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
    system: SYSTEM_PROMPT,
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
