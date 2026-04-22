import { readFileSync, writeFileSync, chmodSync, mkdirSync, existsSync, } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isValidMode } from "./policy.js";
// Persistance permissions : ~/.aicli/permissions.json (chmod 0600 comme
// credentials). Env var AICLI_MODE override tout (usage CI / bypass temporaire).
const DIR = join(homedir(), ".aicli");
const FILE = join(DIR, "permissions.json");
const DEFAULT_CONFIG = {
    mode: "default",
    alwaysAllow: [],
};
export function loadPermissions() {
    // Env vars d'abord (plus rapide et pas de disk touch en CI).
    const envMode = process.env.AICLI_MODE;
    if (envMode && isValidMode(envMode)) {
        return { ...DEFAULT_CONFIG, mode: envMode };
    }
    if (!existsSync(FILE))
        return { ...DEFAULT_CONFIG };
    try {
        const raw = readFileSync(FILE, "utf8");
        const parsed = JSON.parse(raw);
        const mode = parsed.mode && isValidMode(parsed.mode) ? parsed.mode : "default";
        const alwaysAllow = Array.isArray(parsed.alwaysAllow)
            ? parsed.alwaysAllow.filter((s) => typeof s === "string")
            : [];
        return { mode, alwaysAllow };
    }
    catch {
        return { ...DEFAULT_CONFIG };
    }
}
export function savePermissions(cfg) {
    if (!existsSync(DIR))
        mkdirSync(DIR, { recursive: true, mode: 0o700 });
    writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    try {
        chmodSync(FILE, 0o600);
    }
    catch {
        // Windows : chmod pas supporté, on ignore.
    }
}
export function permissionsFilePath() {
    return FILE;
}
