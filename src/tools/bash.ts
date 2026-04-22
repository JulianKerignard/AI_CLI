import { spawn } from "node:child_process";
import type { Tool } from "./types.js";

// Cap output pour éviter qu'un `npm install` / `npm test` verbeux pollue
// l'historique de l'agent (renvoyé à chaque turn suivant = coût exponentiel).
// 32k chars ≈ 8k tokens — garde les dernières lignes où les erreurs/exit
// apparaissent généralement. Les headers/progress bars en début sont sacrifiés.
const MAX_STREAM_CHARS = 32_000;

function tailCap(text: string, label: string): string {
  if (text.length <= MAX_STREAM_CHARS) return text;
  const tail = text.slice(-MAX_STREAM_CHARS);
  const droppedChars = text.length - tail.length;
  const lines = text.split("\n").length;
  const keptLines = tail.split("\n").length;
  return (
    `[${label} tronqué : ${droppedChars.toLocaleString()} chars coupés au début, garde les ${keptLines} dernières lignes sur ${lines}]\n` +
    tail
  );
}

export const bashTool: Tool = {
  name: "Bash",
  description: "Exécute une commande shell (timeout 30s). Stdout/stderr capés à 32k chars chacun (tail) pour préserver l'historique agent.",
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
      const child = spawn("sh", ["-c", command], {
        cwd: ctx.cwd,
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise(
          `[timeout après ${timeout}ms]\nstdout:\n${tailCap(stdout, "stdout")}\nstderr:\n${tailCap(stderr, "stderr")}`,
        );
      }, timeout);

      child.stdout.on("data", (c) => {
        stdout += c.toString();
        // Garde 2× la cap en mémoire live pour autoriser le tail final sans
        // allouer un buffer de plusieurs MB pour un `npm install` très bavard.
        if (stdout.length > MAX_STREAM_CHARS * 2) {
          stdout = stdout.slice(-MAX_STREAM_CHARS * 2);
        }
      });
      child.stderr.on("data", (c) => {
        stderr += c.toString();
        if (stderr.length > MAX_STREAM_CHARS * 2) {
          stderr = stderr.slice(-MAX_STREAM_CHARS * 2);
        }
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const head = `exit ${code}`;
        const body = [
          stdout && `stdout:\n${tailCap(stdout, "stdout")}`,
          stderr && `stderr:\n${tailCap(stderr, "stderr")}`,
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
