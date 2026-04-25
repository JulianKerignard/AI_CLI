import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

// Stockage des sessions AI_CLI — une session = un lancement du REPL.
// Format : ~/.aicli/sessions/<cwd-hash>/<session-id>.jsonl
// - cwd-hash : md5 du cwd, pour que /resume liste uniquement les sessions
//   lancées depuis le même dossier (convention Claude Code)
// - session-id : timestamp + random, pour tri naturel
// - jsonl : 1 ligne header + N lignes d'events, append-only

const BASE = join(homedir(), ".aicli", "sessions");

export type SessionEventType =
  | "user"
  | "assistant"
  | "tool_use"
  | "tool_result";

export interface SessionHeader {
  type: "session";
  id: string;
  cwd: string;
  model: string;
  startedAt: number;
}

export interface SessionEvent {
  type: SessionEventType;
  content: unknown;
  ts: number;
}

export interface SessionSummary {
  id: string;
  path: string;
  startedAt: number;
  model: string;
  title: string; // 1er user message (tronqué)
  messageCount: number;
  sizeBytes: number;
  cwd: string; // dossier d'origine de la session, pour /resume --all
}

function cwdHash(cwd: string): string {
  return createHash("md5").update(cwd).digest("hex").slice(0, 16);
}

function dirForCwd(cwd: string): string {
  return join(BASE, cwdHash(cwd));
}

export function newSessionId(): string {
  const ts = Date.now();
  const rand = randomBytes(3).toString("hex");
  return `${ts}-${rand}`;
}

// Crée le fichier session avec son header. Retourne le path, ou null
// si I/O fail (disk full, perms, FS read-only) — le REPL continue sans
// persistance plutôt que crash au boot.
export function openSession(
  id: string,
  cwd: string,
  model: string,
): string | null {
  try {
    const dir = dirForCwd(cwd);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${id}.jsonl`);
    const header: SessionHeader = {
      type: "session",
      id,
      cwd,
      model,
      startedAt: Date.now(),
    };
    writeFileSync(path, JSON.stringify(header) + "\n", { mode: 0o600 });
    return path;
  } catch (err) {
    console.warn("[session] openSession failed:", err);
    return null;
  }
}

// Append un event à la session courante. Best-effort — si écriture foire
// (disk full, perms) on log mais on ne plante pas le REPL. No-op si path=null.
export function appendEvent(
  path: string | null,
  type: SessionEventType,
  content: unknown,
): void {
  if (!path) return;
  try {
    const ev: SessionEvent = { type, content, ts: Date.now() };
    appendFileSync(path, JSON.stringify(ev) + "\n");
  } catch (err) {
    console.warn("[session] append failed:", err);
  }
}

// Liste les sessions du cwd, triées desc par startedAt (plus récente en 1er).
export function listSessions(cwd: string, limit = 20): SessionSummary[] {
  const dir = dirForCwd(cwd);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  const out: SessionSummary[] = [];
  for (const f of files) {
    const path = join(dir, f);
    try {
      const summary = summarize(path);
      if (summary) out.push(summary);
    } catch {
      // Fichier corrompu — on skip.
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

function summarize(path: string): SessionSummary | null {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  const header = JSON.parse(lines[0]) as SessionHeader;
  if (header.type !== "session") return null;

  let title = "(pas de message)";
  let messageCount = 0;
  for (const ln of lines.slice(1)) {
    try {
      const ev = JSON.parse(ln) as SessionEvent;
      if (ev.type === "user" || ev.type === "assistant") {
        messageCount += 1;
        if (ev.type === "user" && title === "(pas de message)") {
          const s = typeof ev.content === "string" ? ev.content : String(ev.content);
          title = s.slice(0, 80).replace(/\n/g, " ");
        }
      }
    } catch {
      /* skip */
    }
  }
  const st = statSync(path);
  return {
    id: header.id,
    path,
    startedAt: header.startedAt,
    model: header.model,
    title,
    messageCount,
    sizeBytes: st.size,
    cwd: header.cwd,
  };
}

// Liste TOUTES les sessions tous dossiers confondus, triées desc par
// startedAt. Pour /resume --all : permet de retrouver une conversation
// même si on relance le CLI depuis un autre dossier que le projet d'origine.
export function listAllSessions(limit = 30): SessionSummary[] {
  if (!existsSync(BASE)) return [];
  const out: SessionSummary[] = [];
  for (const hashDir of readdirSync(BASE)) {
    const dir = join(BASE, hashDir);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const path = join(dir, f);
      try {
        const summary = summarize(path);
        if (summary) out.push(summary);
      } catch {
        // Fichier corrompu — on skip.
      }
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

// Charge tous les events d'une session pour replay.
export function loadSession(
  path: string,
): { header: SessionHeader; events: SessionEvent[] } | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  const header = JSON.parse(lines[0]) as SessionHeader;
  if (header.type !== "session") return null;
  const events: SessionEvent[] = [];
  for (const ln of lines.slice(1)) {
    try {
      events.push(JSON.parse(ln) as SessionEvent);
    } catch {
      /* skip */
    }
  }
  return { header, events };
}
