import readline from "node:readline";
import { CWD } from "./utils/paths.js";
import { log, chalk } from "./utils/logger.js";
import { renderBanner } from "./utils/banner.js";
import { createBaseRegistry } from "./tools/registry.js";
import { DemoProvider } from "./agent/demo-provider.js";
import { AgentLoop } from "./agent/loop.js";
import { CommandRegistry } from "./commands/registry.js";
import { loadSkills } from "./skills/loader.js";
import { makeSkillTool } from "./skills/tool.js";
import { loadSubAgents } from "./agents/loader.js";
import { makeAgentTool } from "./agents/tool.js";
import { loadMcpServers } from "./mcp/config.js";

const SYSTEM_PROMPT = `Tu es AI_CLI, un assistant CLI local inspiré de Claude Code.
Tu disposes d'outils (Read, Write, Bash, Skill, Agent, mcp__*) pour accomplir des tâches.
Réponds en français, sois concis, et utilise les outils quand c'est utile.`;

export async function startRepl(): Promise<void> {
  const tools = createBaseRegistry();
  const provider = new DemoProvider();

  const agent = new AgentLoop({
    system: SYSTEM_PROMPT,
    provider,
    tools,
    cwd: CWD,
  });

  const skills = loadSkills();
  const subAgents = loadSubAgents();

  tools.register(makeSkillTool(skills, agent));
  tools.register(makeAgentTool({ subAgents, provider, parentTools: tools }));

  const mcpServers = await loadMcpServers(tools);

  const commands = new CommandRegistry();

  console.log(
    renderBanner(
      `v0.1.0  ·  provider: ${provider.name}  ·  ${tools.list().length} tools · ${skills.length} skills · ${subAgents.length} agents · ${mcpServers.length} MCP`,
    ),
  );
  log.dim(`  cwd: ${CWD}`);
  log.dim("  Tape /help pour les commandes. Tab pour l'auto-complétion. Ctrl-D ou /exit pour quitter.\n");

  const completer = (line: string): [string[], string] => {
    if (!line.startsWith("/")) return [[], line];
    const matches = commands
      .list()
      .map((c) => "/" + c.name)
      .filter((c) => c.startsWith(line));
    return [matches.length ? matches : [], line];
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.blue("» "),
    completer,
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
