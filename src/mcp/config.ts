import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { aicliDirs } from "../utils/paths.js";
import type { McpServerConfig } from "./client.js";
import { McpClient, type McpServer, mcpToolAsLocalTool } from "./client.js";
import type { ToolRegistry } from "../tools/registry.js";
import { log } from "../utils/logger.js";

interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

// Trust-on-first-use : on fait confiance uniquement au mcp.json global
// (~/.aicli/mcp.json) que l'user a explicitement créé. Les mcp.json projet
// (dans cwd) peuvent contenir des commandes malveillantes (repo cloné) et
// sont skippés par défaut. Override via AICLI_TRUST_PROJECT_MCP=1.
const HOME_AICLI = join(homedir(), ".aicli");

function isProjectMcpConfig(dir: string): boolean {
  return dir !== HOME_AICLI;
}

export async function loadMcpServers(tools: ToolRegistry): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  const trustProject = process.env.AICLI_TRUST_PROJECT_MCP === "1";
  for (const dir of aicliDirs()) {
    const file = join(dir, "mcp.json");
    if (!existsSync(file)) continue;
    if (isProjectMcpConfig(dir) && !trustProject) {
      log.warn(
        `mcp.json projet détecté (${file}) mais pas chargé. ` +
          `Sécurité : un repo cloné ne doit pas lancer de subprocess. ` +
          `Set AICLI_TRUST_PROJECT_MCP=1 pour l'autoriser ou déplace la config vers ~/.aicli/mcp.json.`,
      );
      continue;
    }
    let config: McpConfigFile;
    try {
      config = JSON.parse(readFileSync(file, "utf8")) as McpConfigFile;
    } catch (err) {
      log.warn(`mcp.json invalide (${file}): ${(err as Error).message}`);
      continue;
    }
    for (const [name, serverConfig] of Object.entries(config.mcpServers ?? {})) {
      try {
        const client = new McpClient(name, serverConfig);
        await client.initialize();
        const infos = await client.listTools();
        for (const info of infos) tools.register(mcpToolAsLocalTool(client, info));
        servers.push({
          name,
          status: `connecté (${infos.length} outils)`,
          tools: infos,
          close: () => client.close(),
        });
        log.info(`MCP '${name}' connecté (${infos.length} outils).`);
      } catch (err) {
        log.warn(`MCP '${name}' a échoué: ${(err as Error).message}`);
      }
    }
  }
  return servers;
}
