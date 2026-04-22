import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
let cached = null;
export function detectShell() {
    if (cached)
        return cached;
    cached = doDetect();
    return cached;
}
function doDetect() {
    if (process.platform !== "win32") {
        return {
            cmd: "sh",
            args: (c) => ["-c", c],
            kind: "posix",
            label: "sh (POSIX)",
        };
    }
    // Windows : cherche un bash POSIX dans cet ordre.
    const candidates = [
        // Git for Windows — installé chez la majorité des devs Windows.
        {
            path: "C:\\Program Files\\Git\\bin\\bash.exe",
            kind: "posix",
            label: "Git Bash",
        },
        {
            path: "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
            kind: "posix",
            label: "Git Bash (x86)",
        },
        // WSL : wsl.exe est dispo de base sur Windows 10+.
        { path: "wsl.exe", kind: "posix", label: "WSL" },
    ];
    for (const cand of candidates) {
        if (cand.path.includes("\\") && existsSync(cand.path)) {
            return {
                cmd: cand.path,
                args: (c) => ["-c", c],
                kind: cand.kind,
                label: cand.label,
            };
        }
        if (!cand.path.includes("\\") && hasCommand(cand.path)) {
            return {
                cmd: cand.path,
                // wsl.exe : `wsl bash -c "cmd"` ou directement `wsl -- cmd` (run in
                // default distro). On utilise bash -c pour que la syntaxe reste la
                // même que sur Unix.
                args: cand.path === "wsl.exe"
                    ? (c) => ["bash", "-c", c]
                    : (c) => ["-c", c],
                kind: cand.kind,
                label: cand.label,
            };
        }
    }
    // Tente `bash` nu (peut être dans PATH via MSYS2, Cygwin, Scoop, Chocolatey).
    if (hasCommand("bash")) {
        return {
            cmd: "bash",
            args: (c) => ["-c", c],
            kind: "posix",
            label: "bash (PATH)",
        };
    }
    // PowerShell 7 (pwsh) — cross-platform, syntaxe moderne.
    if (hasCommand("pwsh")) {
        return {
            cmd: "pwsh",
            args: (c) => ["-NoProfile", "-Command", c],
            kind: "pwsh",
            label: "PowerShell 7",
        };
    }
    // PowerShell 5 (legacy Windows).
    if (hasCommand("powershell")) {
        return {
            cmd: "powershell",
            args: (c) => ["-NoProfile", "-Command", c],
            kind: "pwsh",
            label: "PowerShell 5",
        };
    }
    // Dernier recours : cmd.exe. Syntaxe très limitée, adapter le system
    // prompt côté agent pour éviter `|`, `&&`, `ls`, etc.
    return {
        cmd: "cmd.exe",
        args: (c) => ["/d", "/s", "/c", c],
        kind: "cmd",
        label: "cmd.exe",
    };
}
function hasCommand(bin) {
    try {
        const cmd = process.platform === "win32" ? "where" : "which";
        execSync(`${cmd} ${bin}`, { stdio: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}
// Hint pour le system prompt — dit à l'agent quelle syntaxe utiliser.
export function shellSyntaxHint(info) {
    if (info.kind === "posix") {
        return `Shell disponible : ${info.label}. Utilise la syntaxe POSIX bash (|, &&, $VAR, ls/cat/grep/head, etc.).`;
    }
    if (info.kind === "pwsh") {
        return `Shell disponible : ${info.label} (PowerShell). Utilise la syntaxe PowerShell (Get-ChildItem au lieu de ls, Select-String au lieu de grep, | pour pipe). Les commandes POSIX ne marchent PAS.`;
    }
    return `Shell disponible : ${info.label} (Windows cmd). Syntaxe limitée : utilise dir/type/findstr, pas de ls/cat/grep. Les pipes | marchent mais && est limité.`;
}
