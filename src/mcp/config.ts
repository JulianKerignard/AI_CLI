import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aicliDirs } from "../utils/paths.js";
import type { McpServerConfig } from "./client.js";
import { McpClient, type McpServer, mcpToolAsLocalTool } from "./client.js";
import type { ToolRegistry } from "../tools/registry.js";
import { log } from "../utils/logger.js";

interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

export async function loadMcpServers(tools: ToolRegistry): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  for (const dir of aicliDirs()) {
    const file = join(dir, "mcp.json");
    if (!existsSync(file)) continue;
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
