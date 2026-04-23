import { isAbsolute, resolve, sep } from "node:path";
import { homedir } from "node:os";
// Guard : empêche le LLM de lire/écrire des fichiers sensibles hors du cwd.
// Sans ce guard, un prompt injection via fichier Read pouvait exfiltrer
// ~/.aicli/credentials.json ou ~/.ssh/id_rsa silencieusement.
//
// Stratégie :
// - `resolvePath(raw, cwd)` retourne un path absolu normalisé
// - `guardPath(abs, cwd, mode)` throw si hors cwd ET dans denylist
//   (sauf override explicite via AICLI_ALLOW_UNSAFE_PATHS=1)
const HOME = homedir();
// Denylist absolue : interdit même avec accord user (trop sensible).
// Paths normalisés en absolu pour éviter les ..escape.
function denyList() {
    return [
        `${HOME}/.ssh`,
        `${HOME}/.aws`,
        `${HOME}/.gnupg`,
        `${HOME}/.aicli/credentials.json`,
        `${HOME}/.config/gh`,
        `${HOME}/.netrc`,
        "/etc/shadow",
        "/etc/sudoers",
        "/etc/passwd",
        "/root",
    ];
}
// Patterns relatifs (n'importe où) qui contiennent des secrets.
const SECRET_BASENAMES = new Set([
    "credentials.json",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    ".env",
    ".env.local",
    ".env.production",
    ".env.prod",
    "secrets.json",
]);
export function resolvePath(raw, cwd) {
    return isAbsolute(raw) ? raw : resolve(cwd, raw);
}
export function guardPath(absPath, opts) {
    if (process.env.AICLI_ALLOW_UNSAFE_PATHS === "1")
        return;
    const deny = denyList();
    for (const denied of deny) {
        if (absPath === denied || absPath.startsWith(denied + sep)) {
            throw new Error(`Accès refusé : ${absPath} est dans la denylist (secrets système). ` +
                `Set AICLI_ALLOW_UNSAFE_PATHS=1 pour bypass.`);
        }
    }
    // Basename dans la liste de secrets : accès refusé sauf si dans cwd.
    const basename = absPath.split(sep).pop() ?? "";
    if (SECRET_BASENAMES.has(basename)) {
        const inCwd = absPath === opts.cwd || absPath.startsWith(opts.cwd + sep);
        if (!inCwd) {
            throw new Error(`Accès refusé : ${basename} en dehors du cwd est suspect (secret). ` +
                `Set AICLI_ALLOW_UNSAFE_PATHS=1 pour bypass.`);
        }
    }
    // Write hors cwd : denied sauf override. Read hors cwd : autorisé pour
    // permettre de consulter des fichiers système légitimes (ex: /etc/hosts).
    if (opts.mode === "write") {
        const inCwd = absPath === opts.cwd || absPath.startsWith(opts.cwd + sep);
        if (!inCwd) {
            throw new Error(`Écriture refusée hors du cwd : ${absPath}. ` +
                `Restez dans ${opts.cwd}. Override via AICLI_ALLOW_UNSAFE_PATHS=1.`);
        }
    }
}
