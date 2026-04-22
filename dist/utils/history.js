import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
const FILE = join(homedir(), ".aicli", "history.json");
const MAX_ITEMS = 200;
// Historique persistent des inputs utilisateur au prompt du REPL. Remplace
// la gestion native readline (flèches ↑↓) qu'on perd en migrant vers
// @inquirer/input. Persisté à chaque add() pour survivre aux crash.
export class InputHistory {
    items = [];
    cursor = -1;
    constructor() {
        this.load();
    }
    load() {
        try {
            if (!existsSync(FILE))
                return;
            const raw = readFileSync(FILE, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                this.items = parsed.filter((x) => typeof x === "string");
            }
        }
        catch {
            // corruption / perms → on démarre à vide, pas bloquant.
        }
    }
    persist() {
        try {
            mkdirSync(dirname(FILE), { recursive: true });
            writeFileSync(FILE, JSON.stringify(this.items.slice(-MAX_ITEMS)), {
                mode: 0o600,
            });
        }
        catch {
            // best-effort
        }
    }
    // Ajoute une entrée. Déduplique le dernier item pour éviter de polluer
    // avec des répétitions immédiates.
    add(input) {
        const trimmed = input.trim();
        if (!trimmed)
            return;
        if (this.items[this.items.length - 1] === trimmed) {
            this.cursor = -1;
            return;
        }
        this.items.push(trimmed);
        if (this.items.length > MAX_ITEMS) {
            this.items.splice(0, this.items.length - MAX_ITEMS);
        }
        this.cursor = -1;
        this.persist();
    }
    prev() {
        if (this.items.length === 0)
            return null;
        if (this.cursor === -1)
            this.cursor = this.items.length;
        this.cursor = Math.max(0, this.cursor - 1);
        return this.items[this.cursor] ?? null;
    }
    next() {
        if (this.cursor === -1)
            return null;
        this.cursor += 1;
        if (this.cursor >= this.items.length) {
            this.cursor = -1;
            return "";
        }
        return this.items[this.cursor] ?? null;
    }
    resetCursor() {
        this.cursor = -1;
    }
    snapshot() {
        return this.items;
    }
}
