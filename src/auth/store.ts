import {
  readFileSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Stockage des credentials CLI. Par défaut fichier `~/.aicli/credentials.json`
// avec permissions 0600 (pattern gh / aws / vercel). Les env vars ont priorité
// absolue pour permettre CI/Docker/sandbox sans fichier.

const DIR = join(homedir(), ".aicli");
const FILE = join(DIR, "credentials.json");
export const DEFAULT_BASE_URL = "https://chat.juliankerignard.fr/api";
export const DEFAULT_MODEL = "mistral-large-latest";

export interface Credentials {
  token: string;
  baseUrl: string;
  model: string;
}

export function loadCredentials(): Credentials | null {
  // Priorité 1 : env vars — idéal CI / Docker / sandbox
  const envToken = process.env.AICLI_AUTH_TOKEN ?? process.env.ANTHROPIC_AUTH_TOKEN;
  if (envToken) {
    return {
      token: envToken,
      baseUrl: process.env.AICLI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? DEFAULT_BASE_URL,
      model: process.env.AICLI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    };
  }
  // Priorité 2 : fichier local
  if (!existsSync(FILE)) return null;
  try {
    const raw = readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Credentials>;
    if (!parsed.token || typeof parsed.token !== "string") return null;
    return {
      token: parsed.token,
      baseUrl: parsed.baseUrl ?? DEFAULT_BASE_URL,
      model: parsed.model ?? DEFAULT_MODEL,
    };
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const data = JSON.stringify(creds, null, 2);
  writeFileSync(FILE, data, { mode: 0o600 });
  // chmod explicite car writeFileSync respecte umask qui peut élargir les perms
  try {
    chmodSync(FILE, 0o600);
  } catch {
    // Windows : chmod non supporté, on ignore silencieusement
  }
}

export function clearCredentials(): void {
  if (existsSync(FILE)) unlinkSync(FILE);
}

// Check que le fichier n'est pas lisible par d'autres users (équivalent
// StrictModes SSH). Avertit l'user si les perms sont trop permissives.
export function checkCredentialsPerms(): { ok: boolean; warning?: string } {
  if (!existsSync(FILE)) return { ok: true };
  try {
    const s = statSync(FILE);
    const mode = s.mode & 0o777;
    if (mode & 0o077) {
      return {
        ok: false,
        warning: `~/.aicli/credentials.json a des permissions trop larges (${mode.toString(8)}). Exécute : chmod 600 ${FILE}`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
