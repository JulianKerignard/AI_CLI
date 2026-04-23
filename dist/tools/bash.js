import { spawn } from "node:child_process";
import { detectShell } from "./shell-detect.js";
// Cap output pour éviter qu'un `npm install` / `npm test` verbeux pollue
// l'historique de l'agent (renvoyé à chaque turn suivant = coût exponentiel).
// 32k chars ≈ 8k tokens — garde les dernières lignes où les erreurs/exit
// apparaissent généralement. Les headers/progress bars en début sont sacrifiés.
const MAX_STREAM_CHARS = 32_000;
function tailCap(text, label) {
    if (text.length <= MAX_STREAM_CHARS)
        return text;
    const tail = text.slice(-MAX_STREAM_CHARS);
    const droppedChars = text.length - tail.length;
    const lines = text.split("\n").length;
    const keptLines = tail.split("\n").length;
    return (`[${label} tronqué : ${droppedChars.toLocaleString()} chars coupés au début, garde les ${keptLines} dernières lignes sur ${lines}]\n` +
        tail);
}
export const bashTool = {
    name: "Bash",
    description: "Exécute une commande shell (timeout 30s). Stdout/stderr capés à 32k chars chacun (tail) pour préserver l'historique agent.",
    formatInvocation: (input) => {
        const cmd = String(input.command ?? "");
        return cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd;
    },
    formatResult: (_input, output) => {
        // output = "exit N\nstdout:\n…\nstderr:\n…"
        const exitMatch = /^exit (\S+)/m.exec(output);
        const code = exitMatch ? exitMatch[1] : "?";
        const stdoutBlock = output.split("stdout:\n")[1]?.split("\nstderr:")[0] ?? "";
        const stderrBlock = output.split("stderr:\n")[1] ?? "";
        const stdoutLines = stdoutBlock ? stdoutBlock.split("\n").filter(Boolean).length : 0;
        const hasStderr = stderrBlock.trim().length > 0;
        const truncated = /\[(stdout|stderr) tronqué/.test(output);
        const timeout = /^\[timeout/.test(output);
        if (timeout)
            return "timeout";
        // Inline le stdout si court (≤5 lignes, ≤300 chars) pour que l'user
        // voie directement le résultat de `echo`, `pwd`, `date`, etc.
        const stdoutTrimmed = stdoutBlock.trim();
        if (code === "0" &&
            !hasStderr &&
            !truncated &&
            stdoutLines > 0 &&
            stdoutLines <= 5 &&
            stdoutTrimmed.length <= 300) {
            const indented = stdoutTrimmed.split("\n").map((l) => "  " + l).join("\n");
            return `exit 0\n${indented}`;
        }
        const parts = [`exit ${code}`];
        if (stdoutLines > 0)
            parts.push(`${stdoutLines} stdout lines`);
        if (hasStderr)
            parts.push("stderr");
        if (truncated)
            parts.push("(tail)");
        return parts.join(" · ");
    },
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
        if (!command)
            throw new Error("Bash: 'command' manquant");
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
            return ("exit 1\nstderr:\n[bloqué] N'utilise pas Bash pour parler. Écris " +
                "directement le texte dans ta réponse — il s'affiche à l'utilisateur " +
                "sans passer par un outil. Bash est réservé aux vraies commandes " +
                "système (install, test, build, inspection fichiers).");
        }
        // Détection cross-plateforme : sh sur Unix, Git Bash / WSL / pwsh /
        // cmd.exe sur Windows selon ce qui est dispo. L'agent reçoit un
        // hint dans le system prompt pour adapter la syntaxe si besoin.
        const shell = detectShell();
        return await new Promise((resolvePromise) => {
            const child = spawn(shell.cmd, shell.args(command), {
                cwd: ctx.cwd,
                env: process.env,
            });
            let stdout = "";
            let stderr = "";
            const timer = setTimeout(() => {
                child.kill("SIGKILL");
                resolvePromise(`[timeout après ${timeout}ms]\nstdout:\n${tailCap(stdout, "stdout")}\nstderr:\n${tailCap(stderr, "stderr")}`);
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
