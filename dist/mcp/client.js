import { spawn } from "node:child_process";
/**
 * Client MCP stdio minimal : line-delimited JSON-RPC 2.0.
 * Implémente juste ce qu'il faut : initialize, tools/list, tools/call.
 */
export class McpClient {
    name;
    child;
    nextId = 1;
    pending = new Map();
    buffer = "";
    constructor(name, config) {
        this.name = name;
        this.child = spawn(config.command, config.args ?? [], {
            env: { ...process.env, ...config.env },
            stdio: ["pipe", "pipe", "pipe"],
        });
        this.child.stdout.setEncoding("utf8");
        this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
        this.child.stderr.on("data", () => {
            /* silencieux — beaucoup de serveurs MCP loguent là */
        });
        this.child.on("error", (err) => {
            for (const cb of this.pending.values()) {
                cb({ jsonrpc: "2.0", id: -1, error: { code: -1, message: err.message } });
            }
            this.pending.clear();
        });
    }
    onStdout(chunk) {
        this.buffer += chunk;
        let idx;
        while ((idx = this.buffer.indexOf("\n")) !== -1) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (!line)
                continue;
            try {
                const msg = JSON.parse(line);
                if (typeof msg.id === "number") {
                    const cb = this.pending.get(msg.id);
                    if (cb) {
                        this.pending.delete(msg.id);
                        cb(msg);
                    }
                }
            }
            catch {
                /* ignore ligne non-JSON */
            }
        }
    }
    request(method, params, timeoutMs = 10_000) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const payload = { jsonrpc: "2.0", id, method, params };
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP ${method} timeout`));
            }, timeoutMs);
            this.pending.set(id, (res) => {
                clearTimeout(timer);
                resolve(res);
            });
            this.child.stdin.write(JSON.stringify(payload) + "\n");
        });
    }
    async initialize() {
        await this.request("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "aicli", version: "0.1.0" },
        });
        this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    }
    async listTools() {
        const res = await this.request("tools/list");
        const result = (res.result ?? {});
        return result.tools ?? [];
    }
    async callTool(name, args) {
        const res = await this.request("tools/call", { name, arguments: args });
        if (res.error)
            throw new Error(res.error.message);
        const result = (res.result ?? {});
        const texts = (result.content ?? [])
            .map((c) => (c.type === "text" ? c.text ?? "" : JSON.stringify(c)))
            .join("\n");
        return result.isError ? `[mcp error] ${texts}` : texts;
    }
    close() {
        this.child.kill();
    }
}
export function mcpToolAsLocalTool(server, info) {
    const schema = info.inputSchema ?? {};
    return {
        name: `mcp__${server.name}__${info.name}`,
        description: info.description ?? `Outil MCP ${info.name} depuis ${server.name}`,
        schema: {
            type: "object",
            properties: schema.properties ?? {},
            required: schema.required ?? [],
        },
        async run(input) {
            return await server.callTool(info.name, input);
        },
    };
}
