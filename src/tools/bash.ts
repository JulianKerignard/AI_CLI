import { spawn } from "node:child_process";
import type { Tool } from "./types.js";
import { detectShell } from "./shell-detect.js";
import { shellManager } from "./shell-manager.js";

// Cap output pour éviter qu'un `npm install` / `npm test` verbeux pollue
// l'historique de l'agent (renvoyé à chaque turn suivant = coût exponentiel).
// 32k chars ≈ 8k tokens — garde les dernières lignes où les erreurs/exit
// apparaissent généralement. Les headers/progress bars en début sont sacrifiés.
// Cap réduit de 32k → 8k chars (~2k tokens) : 32k = 8k tokens bouffés dans
// l'historique agent à chaque npm install verbeux. Tail reste plus informatif
// que head pour les sorties de commandes (erreurs + résumé en fin).
const MAX_STREAM_CHARS = 8_000;

function tailCap(text: string, label: string): string {
  if (text.length <= MAX_STREAM_CHARS) return text;
  const tail = text.slice(-MAX_STREAM_CHARS);
  const droppedChars = text.length - tail.length;
  const lines = text.split(/\r?\n/).length;
  const keptLines = tail.split(/\r?\n/).length;
  return (
    `[${label} tronqué : ${droppedChars.toLocaleString()} chars coupés au début, garde les ${keptLines} dernières lignes sur ${lines}]\n` +
    tail
  );
}

export const bashTool: Tool = {
  name: "Bash",
  description:
    "Exécute une commande shell. Mode synchrone par défaut (timeout 30s, stdout/stderr capés à 8k chars). " +
    "Si run_in_background=true : lance la commande en arrière-plan, retourne immédiatement un shell_id. " +
    "Utilise BashOutput pour lire les logs au fil de l'eau, KillShell pour stopper. " +
    "À utiliser pour les tâches longues (dev server, watch, build long, tests).",
  formatInvocation: (input) => {
    const cmd = String(input.command ?? "");
    const bg = Boolean(input.run_in_background);
    const prefix = bg ? "$& " : "$ "; // & = arrière-plan style shell
    const trimmed = cmd.length > 70 ? cmd.slice(0, 70) + "…" : cmd;
    return prefix + trimmed;
  },
  formatResult: (input, output) => {
    // Mode background : output commence par 'shell_id: <id>'.
    if (Boolean(input.run_in_background)) {
      const idMatch = /shell_id:\s*(\w+)/.exec(output);
      const id = idMatch ? idMatch[1] : "?";
      return `started · shell_id ${id}`;
    }
    // output = "exit N\nstdout:\n…\nstderr:\n…"
    const exitMatch = /^exit (\S+)/m.exec(output);
    const code = exitMatch ? exitMatch[1] : "?";
    const stdoutBlock =
      output.split("stdout:\n")[1]?.split("\nstderr:")[0] ?? "";
    const stderrBlock = output.split("stderr:\n")[1] ?? "";
    const stdoutLines = stdoutBlock
      ? stdoutBlock.split(/\r?\n/).filter(Boolean).length
      : 0;
    const hasStderr = stderrBlock.trim().length > 0;
    const truncated = /\[(stdout|stderr) tronqué/.test(output);
    const timeout = /^\[timeout/.test(output);
    if (timeout) return "exit timeout";
    // Inline le stdout si court (≤5 lignes, ≤300 chars) pour que l'user
    // voie directement le résultat de `echo`, `pwd`, `date`, etc.
    const stdoutTrimmed = stdoutBlock.trim();
    if (
      code === "0" &&
      !hasStderr &&
      !truncated &&
      stdoutLines > 0 &&
      stdoutTrimmed.length <= 300 &&
      stdoutLines <= 5
    ) {
      // Multi-lignes : header `exit 0` + chaque ligne stdout. Le logger
      // colorise `exit 0` en success vert et `$ cmd` en ink.
      return `exit 0\n${stdoutTrimmed}`;
    }
    const parts: string[] = [`exit ${code}`];
    if (stdoutLines > 0) parts.push(`${stdoutLines} stdout lines`);
    if (hasStderr) parts.push("stderr");
    if (truncated) parts.push("(tail)");
    return parts.join(" · ");
  },
  schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Commande à exécuter" },
      timeout_ms: {
        type: "number",
        description: "Timeout en ms (défaut 30000). Ignoré si run_in_background=true.",
      },
      run_in_background: {
        type: "boolean",
        description:
          "Lance en arrière-plan, retourne shell_id immédiatement. " +
          "Utilise pour dev server / watch / build long. " +
          "Lis les logs avec BashOutput, stoppe avec KillShell.",
      },
    },
    required: ["command"],
  },
  async run(input, ctx) {
    const command = String(input.command ?? "");
    const timeout = Number(input.timeout_ms ?? 30000);
    const runInBackground = Boolean(input.run_in_background);
    if (!command) throw new Error("Bash: 'command' manquant");

    // Bloque les `echo`, `printf`, `Write-Host` purs (sans redirection, sans
    // pipe, sans substitution) — utilisés par l'agent pour PARLER à l'user
    // alors qu'il devrait juste écrire du texte dans sa réponse. On ne bloque
    // PAS les usages légitimes comme `echo $VAR`, `echo x > file`, `echo | cat`.
    const trimmed = command.trim();
    const speakPatterns = [
      /^echo(\s+['"]?[^|><$`&;]*['"]?)?\s*$/i,
      /^printf(\s+['"]?[^|><$`&;]*['"]?)?\s*$/i,
      /^Write-Host(\s+['"]?[^|><$`&;]*['"]?)?\s*$/i,
    ];
    if (speakPatterns.some((re) => re.test(trimmed))) {
      return (
        "exit 1\nstderr:\n[bloqué] N'utilise pas Bash pour parler. Écris " +
        "directement le texte dans ta réponse — il s'affiche à l'utilisateur " +
        "sans passer par un outil. Bash est réservé aux vraies commandes " +
        "système (install, test, build, inspection fichiers)."
      );
    }

    // Denylist de patterns destructifs/secret-exfil : s'applique AUSSI en
    // mode bypass. Un prompt injection via fichier Read peut faire
    // rm -rf ~ ou exfil le token. Ces patterns sont toujours interdits
    // sauf override explicite via AICLI_ALLOW_DANGEROUS=1.
    if (process.env.AICLI_ALLOW_DANGEROUS !== "1") {
      const dangerPatterns: Array<{ re: RegExp; why: string }> = [
        { re: /\brm\s+(-[rRf]+\s+)*(\/|~|\$HOME)/, why: "rm -rf / ou ~" },
        { re: /\brm\s+(-[rRf]+\s+)*\.\./, why: "rm -rf parent dir" },
        { re: /(?:curl|wget)\s[^|]*\|\s*(?:sh|bash|zsh)/i, why: "curl|wget | sh" },
        { re: /\bdd\s+.*of=\/dev\//, why: "dd vers /dev/" },
        { re: /\bmkfs\./, why: "mkfs (format disk)" },
        { re: /\b:\(\)\{.*:\|:&.*\};:/, why: "fork bomb" },
        { re: /\bchmod\s+(-R\s+)?777\b/, why: "chmod 777" },
        { re: /(\bsudo\s)|(\bsu\s-)/, why: "sudo/su escalation" },
        { re: /~\/\.ssh|~\/\.aicli\/credentials|~\/\.aws|~\/\.gnupg/, why: "accès fichiers sensibles" },
        { re: /\/etc\/(passwd|shadow|sudoers)/, why: "accès /etc système" },
      ];
      for (const { re, why } of dangerPatterns) {
        if (re.test(trimmed)) {
          return (
            `exit 1\nstderr:\n[bloqué] Commande dangereuse détectée (${why}). ` +
            `Si tu veux vraiment la lancer, set AICLI_ALLOW_DANGEROUS=1 dans ton env.`
          );
        }
      }
    }

    // Mode arrière-plan : on délègue au ShellManager qui retourne
    // immédiatement un shell_id. L'agent peut ensuite poll les logs
    // via BashOutput sans bloquer la boucle. Useful pour : dev server,
    // watch (vitest --watch), build long, tail -f.
    if (runInBackground) {
      const { id, pid } = shellManager.spawn(command, ctx.cwd);
      const lines: string[] = [
        `shell_id: ${id}`,
        `pid: ${pid ?? "?"}`,
        `status: running`,
        ``,
        `command launched in background. Use:`,
        `  BashOutput({ shell_id: "${id}" }) to read accumulated logs`,
        `  KillShell({ shell_id: "${id}" }) to stop`,
      ];
      return lines.join("\n");
    }

    // Détection cross-plateforme : sh sur Unix, Git Bash / WSL / pwsh /
    // cmd.exe sur Windows selon ce qui est dispo. L'agent reçoit un
    // hint dans le system prompt pour adapter la syntaxe si besoin.
    const shell = detectShell();

    return await new Promise<string>((resolvePromise) => {
      const child = spawn(shell.cmd, shell.args(command), {
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
