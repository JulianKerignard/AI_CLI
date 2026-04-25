import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Tool } from "../tools/types.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServer {
  name: string;
  status: string;
  tools: McpToolInfo[];
  close: () => void;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

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

function sanitizeEnv(
  userEnv?: Record<string, string>,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of MCP_ENV_WHITELIST) {
    if (process.env[key] !== undefined) out[key] = process.env[key];
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
      if (DANGEROUS.has(k)) continue;
      out[k] = v;
    }
  }
  return out;
}

const MAX_BUFFER_BYTES = 10_000_000; // 10MB cap pour éviter OOM si serveur buggy

// Timeouts différenciés. `initialize` + `tools/list` sont du handshake
// rapide — 10s est large. `tools/call` peut légitimement durer longtemps
// (fetch web, calcul, etc.) — 60s par défaut, override via env.
const INIT_TIMEOUT_MS = 10_000;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;
function callTimeoutMs(): number {
  const fromEnv = Number(process.env.AICLI_MCP_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_CALL_TIMEOUT_MS;
}

// Version injectée au build par esbuild (--define:__AICLI_VERSION__).
declare const __AICLI_VERSION__: string | undefined;
const CLI_VERSION =
  typeof __AICLI_VERSION__ !== "undefined" && __AICLI_VERSION__ !== ""
    ? __AICLI_VERSION__
    : "dev";

/**
 * Client MCP stdio minimal : line-delimited JSON-RPC 2.0.
 * Implémente juste ce qu'il faut : initialize, tools/list, tools/call.
 */
export class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, (res: JsonRpcResponse) => void>();
  private buffer = "";
  private killed = false;

  constructor(public readonly name: string, config: McpServerConfig) {
    this.child = spawn(config.command, config.args ?? [], {
      env: sanitizeEnv(config.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    // stderr affiché en debug uniquement — sinon masqué (beaucoup de MCP
    // loguent verbosely leur boot, pollue l'UI). AICLI_DEBUG_MCP=1 pour voir.
    this.child.stderr.on("data", (chunk: Buffer) => {
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

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    // Cap buffer pour éviter OOM si serveur MCP envoie du binary sans \n.
    if (this.buffer.length > MAX_BUFFER_BYTES && !this.killed) {
      this.killed = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[mcp:${this.name}] buffer > ${MAX_BUFFER_BYTES} bytes, kill`,
      );
      this.child.kill();
      return;
    }
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        if (typeof msg.id === "number") {
          const cb = this.pending.get(msg.id);
          if (cb) {
            this.pending.delete(msg.id);
            cb(msg);
          }
        }
      } catch {
        // ligne non-JSON — debug only pour éviter bruit
        if (process.env.AICLI_DEBUG_MCP === "1") {
          // eslint-disable-next-line no-console
          console.warn(`[mcp:${this.name}] non-JSON line:`, line.slice(0, 200));
        }
      }
    }
  }

  private request(method: string, params?: unknown, timeoutMs = 10_000): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
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

  async initialize(): Promise<void> {
    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "aicli", version: CLI_VERSION },
      },
      INIT_TIMEOUT_MS,
    );
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
  }

  async listTools(): Promise<McpToolInfo[]> {
    const res = await this.request("tools/list", undefined, INIT_TIMEOUT_MS);
    const result = (res.result ?? {}) as { tools?: McpToolInfo[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.request(
      "tools/call",
      { name, arguments: args },
      callTimeoutMs(),
    );
    if (res.error) throw new Error(res.error.message);
    const result = (res.result ?? {}) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const texts = (result.content ?? [])
      .map((c) => (c.type === "text" ? c.text ?? "" : JSON.stringify(c)))
      .join("\n");
    return result.isError ? `[mcp error] ${texts}` : texts;
  }

  close(): void {
    this.child.kill();
  }
}

export function mcpToolAsLocalTool(server: McpClient, info: McpToolInfo): Tool {
  const schema = (info.inputSchema as
    | { properties?: Record<string, { type: string; description?: string }>; required?: string[] }
    | undefined) ?? {};
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
