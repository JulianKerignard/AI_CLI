import { spawn } from "node:child_process";
// Whitelist env passée aux subprocess MCP : on NE propage PAS les tokens.
// Sans ça, un MCP tiers pourrait lire AICLI_AUTH_TOKEN, ANTHROPIC_API_KEY,
// MISTRAL_API_KEY... dans ses vars d'env.
const MCP_ENV_WHITELIST = [
    "PATH",
    "HOME",
    "USER",
    "USERNAME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TERMINFO",
    "COLORTERM",
    "SHELL",
    "NODE_PATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMFILES",
    "SYSTEMROOT",
    "COMSPEC",
    "WINDIR",
];
function sanitizeEnv(userEnv) {
    const out = {};
    for (const key of MCP_ENV_WHITELIST) {
        if (process.env[key] !== undefined)
            out[key] = process.env[key];
    }
    // Les env vars du config.env passent en dernier (user-controlled). On
    // refuse quand même les env vars dangereuses qui peuvent hijack loaders.
    const DANGEROUS = new Set([
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "NODE_OPTIONS",
        "PYTHONPATH",
    ]);
    if (userEnv) {
        for (const [k, v] of Object.entries(userEnv)) {
            if (DANGEROUS.has(k))
                continue;
            out[k] = v;
        }
    }
    return out;
}
const MAX_BUFFER_BYTES = 10_000_000; // 10MB cap pour éviter OOM si serveur buggy
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
    killed = false;
    constructor(name, config) {
        this.name = name;
        this.child = spawn(config.command, config.args ?? [], {
            env: sanitizeEnv(config.env),
            stdio: ["pipe", "pipe", "pipe"],
        });
        this.child.stdout.setEncoding("utf8");
        this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
        // stderr affiché en debug uniquement — sinon masqué (beaucoup de MCP
        // loguent verbosely leur boot, pollue l'UI). AICLI_DEBUG_MCP=1 pour voir.
        this.child.stderr.on("data", (chunk) => {
            if (process.env.AICLI_DEBUG_MCP === "1") {
                process.stderr.write(`[mcp:${name}] ${chunk}`);
            }
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
        // Cap buffer pour éviter OOM si serveur MCP envoie du binary sans \n.
        if (this.buffer.length > MAX_BUFFER_BYTES && !this.killed) {
            this.killed = true;
            // eslint-disable-next-line no-console
            console.warn(`[mcp:${this.name}] buffer > ${MAX_BUFFER_BYTES} bytes, kill`);
            this.child.kill();
            return;
        }
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
                // ligne non-JSON — debug only pour éviter bruit
                if (process.env.AICLI_DEBUG_MCP === "1") {
                    // eslint-disable-next-line no-console
                    console.warn(`[mcp:${this.name}] non-JSON line:`, line.slice(0, 200));
                }
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
