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

/**
 * Client MCP stdio minimal : line-delimited JSON-RPC 2.0.
 * Implémente juste ce qu'il faut : initialize, tools/list, tools/call.
 */
export class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, (res: JsonRpcResponse) => void>();
  private buffer = "";

  constructor(public readonly name: string, config: McpServerConfig) {
    this.child = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
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

  private onStdout(chunk: string): void {
    this.buffer += chunk;
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
        /* ignore ligne non-JSON */
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
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "aicli", version: "0.1.0" },
    });
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
  }

  async listTools(): Promise<McpToolInfo[]> {
    const res = await this.request("tools/list");
    const result = (res.result ?? {}) as { tools?: McpToolInfo[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.request("tools/call", { name, arguments: args });
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
