import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aicliDirs } from "../utils/paths.js";
import { McpClient, mcpToolAsLocalTool } from "./client.js";
import { log } from "../utils/logger.js";
export async function loadMcpServers(tools) {
    const servers = [];
    for (const dir of aicliDirs()) {
        const file = join(dir, "mcp.json");
        if (!existsSync(file))
            continue;
        let config;
        try {
            config = JSON.parse(readFileSync(file, "utf8"));
        }
        catch (err) {
            log.warn(`mcp.json invalide (${file}): ${err.message}`);
            continue;
        }
        for (const [name, serverConfig] of Object.entries(config.mcpServers ?? {})) {
            try {
                const client = new McpClient(name, serverConfig);
                await client.initialize();
                const infos = await client.listTools();
                for (const info of infos)
                    tools.register(mcpToolAsLocalTool(client, info));
                servers.push({
                    name,
                    status: `connecté (${infos.length} outils)`,
                    tools: infos,
                    close: () => client.close(),
                });
                log.info(`MCP '${name}' connecté (${infos.length} outils).`);
            }
            catch (err) {
                log.warn(`MCP '${name}' a échoué: ${err.message}`);
            }
        }
    }
    return servers;
}
