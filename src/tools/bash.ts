import { spawn } from "node:child_process";
import type { Tool } from "./types.js";

export const bashTool: Tool = {
  name: "Bash",
  description: "Exécute une commande shell (timeout 30s).",
  schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Commande à exécuter" },
      timeout_ms: { type: "number", description: "Timeout en millisecondes (défaut 30000)" },
    },
    required: ["command"],
  },
  async run(input, ctx) {
    const command = String(input.command ?? "");
    const timeout = Number(input.timeout_ms ?? 30000);
    if (!command) throw new Error("Bash: 'command' manquant");

    return await new Promise<string>((resolvePromise) => {
      const isWin = process.platform === "win32";
      const child = spawn(isWin ? "cmd.exe" : "sh", [isWin ? "/c" : "-c", command], {
        cwd: ctx.cwd,
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise(
          `[timeout après ${timeout}ms]\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
      }, timeout);

      child.stdout.on("data", (c) => (stdout += c.toString()));
      child.stderr.on("data", (c) => (stderr += c.toString()));
      child.on("close", (code) => {
        clearTimeout(timer);
        const head = `exit ${code}`;
        const body = [
          stdout && `stdout:\n${stdout}`,
          stderr && `stderr:\n${stderr}`,
        ]
          .filter(Boolean)
          .join("\n");
        resolvePromise(`${head}\n${body}`.trim());
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolvePromise(`[erreur spawn] ${err.message}`);
      });
    });
  },
};
