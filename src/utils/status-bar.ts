import { EventEmitter } from "node:events";
import { sep } from "node:path";
import { chalk } from "./logger.js";
import { getGitInfo } from "./git-info.js";
import {
  cleanProvider as sharedCleanProvider,
  contextWindowFor as sharedContextWindowFor,
} from "../lib/context-window.js";

// Émetteur pour que le composant React StatusLine (Ink) se re-rende
// quand l'état change. Les callers continuent d'utiliser updateStatus,
// setSessionTotals, etc. — ils émettent 'change' pour l'UI.
const emitter = new EventEmitter();
emitter.setMaxListeners(20);
export function subscribeStatus(cb: () => void): () => void {
  emitter.on("change", cb);
  return () => {
    emitter.off("change", cb);
  };
}

// Status block "sticky" : toujours imprimé juste après le dernier contenu
// stdout. Quand du nouveau contenu arrive, on efface le status précédent
// (cursor up + clear to end of screen), on écrit le contenu, on réimprime
// le status en dessous. Résultat : le status suit le curseur au lieu d'être
// fixé en bas du terminal (plus de gap vide quand la session est jeune).
//
// Layout :
//   ... contenu qui scrolle ...
//   ─────────────────────────────────────────  ┤ session-tag ├
//   ◆ model (ctx) · /cwd · branch  │  ↑in ↓out  │  +add -del
//   562k/128k ██░░░░░░░░ 2% ctx · 5h ░░░░ 0/500 0% · bucket 2/3
//   · idle                                                 v0.1.0
//   » _

export type Phase =
  | "idle"
  | "loading"
  | "thinking"
  | "streaming"
  | "waiting-quota"
  | "executing-tool"
  | "compacting"
  | "offline";

interface Segments {
  provider?: string;
  phase: Phase;
  tokensIn?: number;
  tokensOut?: number;
  sessionInTotal?: number;
  sessionOutTotal?: number;
  contextWindow?: number;
  quotaUsed?: number;
  quotaLimit?: number;
  resetAt?: string;
  waitingMsRemaining?: number;
  toolName?: string;
  bucketUsed?: number;
  bucketCapacity?: number;
  bucketCold?: boolean;
  cwd?: string;
  sessionTag?: string;
  permissionMode?: string;
  // Indices /10 du modèle actif — calculés et pushés par le watcher.
  currentQuality?: number;
  currentSpeed?: number;
  // Suggestion automatique quand le poller détecte un modèle avec un
  // meilleur score composite que le modèle courant. Affiché dans la
  // status line avec les deux indices /10 (qualité + vitesse).
  // Reset au switch de modèle.
  suggestedBetter?: {
    id: string;
    qualityOutOf10: number;
    speedOutOf10: number;
  } | null;
}

const state: Segments = { phase: "idle" };
let enabled = false;

const STATUS_LINES = 4; // rule + 3 info lines
const VERSION = "0.1.0";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "idle",
  loading: "chargement du modèle…",
  thinking: "thinking…",
  streaming: "streaming",
  "waiting-quota": "waiting quota",
  "executing-tool": "tool",
  compacting: "compacting…",
  offline: "offline",
};

const PHASE_SYM: Record<Phase, string> = {
  idle: "·",
  loading: "↻",
  thinking: "●",
  streaming: "●",
  "waiting-quota": "⏳",
  "executing-tool": "◆",
  compacting: "↻",
  offline: "○",
};

const PHASE_COLOR: Record<Phase, (s: string) => string> = {
  idle: chalk.hex("#8a8270"),
  loading: chalk.hex("#7fa8a6"),
  thinking: chalk.hex("#ec9470"),
  streaming: chalk.hex("#e27649"),
  "waiting-quota": chalk.hex("#c76a5f"),
  "executing-tool": chalk.hex("#ec9470"),
  compacting: chalk.hex("#bdb3a1"),
  offline: chalk.hex("#8a8270"),
};

const FAINT = chalk.hex("#4a4239");
const MUTED = chalk.hex("#8a8270");
const INK = chalk.hex("#bdb3a1");
const INK_BRIGHT = chalk.hex("#f6f1e8");
const ACCENT = chalk.hex("#e27649");
const ACCENT_SOFT = chalk.hex("#ec9470");
const DANGER = chalk.hex("#c76a5f");
const SUCCESS = chalk.hex("#7fa670");
const TEAL = chalk.hex("#7fa8a6");

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

// Re-exports depuis lib/context-window.ts pour compat interne (ces helpers
// sont utilisés partout dans renderStatusLines).
const cleanProvider = sharedCleanProvider;
const contextWindowFor = sharedContextWindowFor;

function renderBar(
  pct: number,
  width: number,
  color: (s: string) => string = ACCENT,
): string {
  const filled = Math.max(0, Math.min(width, Math.round(pct * width)));
  return color("█".repeat(filled)) + FAINT("░".repeat(width - filled));
}

function shortCwd(cwd: string): string {
  const max = 35;
  if (cwd.length <= max) return cwd;
  const parts = cwd.split(sep).filter(Boolean);
  if (parts.length <= 2) return "..." + sep + parts.slice(-2).join(sep);
  return "..." + sep + parts.slice(-2).join(sep);
}

function formatResetShort(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "?";
  const ms = ts - Date.now();
  if (ms <= 0) return "soon";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function renderStatusLines(cols: number): string[] {
  const tag = state.sessionTag ?? cleanProvider(state.provider ?? "");
  const tagBox = tag
    ? chalk.bgHex("#245454").hex("#f6f1e8")(` ${tag} `)
    : "";
  const ruleLen = Math.max(0, cols - visibleLen(tagBox) - 2);
  const rule = TEAL("─".repeat(ruleLen)) + (tagBox ? "  " + tagBox : "");

  const parts1: string[] = [];
  if (state.provider) {
    const ctxWin = state.contextWindow ?? contextWindowFor(state.provider);
    const ctxStr =
      ctxWin >= 1_000_000 ? `${ctxWin / 1_000_000}M` : `${ctxWin / 1_000}k`;
    let head =
      ACCENT("◆ ") +
      INK_BRIGHT.bold(cleanProvider(state.provider)) +
      FAINT(` (${ctxStr} ctx)`);
    // Indices Q/V du modèle actif — pushés par le watcher à chaque check.
    if (
      state.currentQuality !== undefined &&
      state.currentSpeed !== undefined
    ) {
      head +=
        FAINT("  ") +
        MUTED("Q") +
        INK(String(state.currentQuality)) +
        FAINT("/10 ") +
        MUTED("V") +
        INK(String(state.currentSpeed)) +
        FAINT("/10");
    }
    parts1.push(head);
  }
  if (state.cwd) parts1.push(MUTED(shortCwd(state.cwd)));
  const git = state.cwd ? getGitInfo(state.cwd) : null;
  if (git?.branch) parts1.push(INK("on ") + ACCENT_SOFT.italic(git.branch));

  const tokenSegs: string[] = [];
  if ((state.tokensIn ?? 0) > 0)
    tokenSegs.push(MUTED("↑") + INK(compact(state.tokensIn!)));
  if ((state.tokensOut ?? 0) > 0)
    tokenSegs.push(MUTED("↓") + INK(compact(state.tokensOut!)));
  if (tokenSegs.length > 0) parts1.push(tokenSegs.join(" "));

  if (git && (git.additions > 0 || git.deletions > 0)) {
    parts1.push(SUCCESS(`+${git.additions}`) + " " + DANGER(`-${git.deletions}`));
  }

  const sep = FAINT("  │  ");
  const softSep = FAINT("  ·  ");
  const line1 =
    parts1.slice(0, 3).join(softSep) +
    (parts1.length > 3 ? sep + parts1.slice(3).join(sep) : "");

  const parts2: string[] = [];
  const sessionTotal =
    (state.sessionInTotal ?? 0) + (state.sessionOutTotal ?? 0);
  const ctxWindow =
    state.contextWindow ??
    contextWindowFor(state.provider ?? "mistral-large-latest");
  // Toujours afficher le ctx (même à 0) pour que l'user voie la marge
  // dispo avant de parler au modèle.
  {
    const pct = Math.min(1, sessionTotal / ctxWindow);
    const pctNum = Math.round(pct * 100);
    const bar = renderBar(pct, 10);
    parts2.push(
      INK_BRIGHT(compact(sessionTotal)) +
        FAINT("/") +
        MUTED(compact(ctxWindow)) +
        "  " +
        bar +
        "  " +
        ACCENT(`${pctNum}%`) +
        FAINT(" ctx"),
    );
  }
  if (state.quotaUsed !== undefined && state.quotaLimit) {
    const pct = state.quotaUsed / state.quotaLimit;
    const pctNum = Math.round(pct * 100);
    const color = pct >= 0.9 ? DANGER : pct >= 0.7 ? ACCENT_SOFT : ACCENT;
    const bar = renderBar(pct, 6, color);
    const resetPart = state.resetAt
      ? FAINT(" ⟳") + MUTED(formatResetShort(state.resetAt))
      : "";
    parts2.push(
      MUTED("5h ") +
        bar +
        " " +
        color(`${state.quotaUsed}/${state.quotaLimit}`) +
        FAINT(" ") +
        color(`${pctNum}%`) +
        resetPart,
    );
  }
  if (state.bucketUsed !== undefined && state.bucketCapacity) {
    const coldBadge = state.bucketCold ? " " + DANGER("cold") : "";
    parts2.push(
      MUTED("bucket ") +
        INK(`${state.bucketUsed}/${state.bucketCapacity}`) +
        coldBadge,
    );
  }
  const line2 = parts2.join(FAINT("  ·  "));

  let phaseStr = PHASE_COLOR[state.phase](
    PHASE_SYM[state.phase] + " " + PHASE_LABEL[state.phase],
  );
  if (state.phase === "executing-tool" && state.toolName) {
    phaseStr += MUTED(" " + state.toolName);
  }
  if (state.phase === "waiting-quota" && state.waitingMsRemaining !== undefined) {
    const s = Math.max(1, Math.ceil(state.waitingMsRemaining / 1000));
    phaseStr += MUTED(` ${s}s`);
  }
  // Suggestion "meilleur modèle dispo" détectée par le poller background.
  if (state.suggestedBetter) {
    const parts = state.suggestedBetter.id.split("/");
    const shortId = parts[parts.length - 1] || state.suggestedBetter.id;
    phaseStr +=
      FAINT("  ·  ") +
      SUCCESS("★ ") +
      ACCENT_SOFT(shortId) +
      FAINT(" · ") +
      MUTED("Q") +
      INK(String(state.suggestedBetter.qualityOutOf10)) +
      FAINT("/10 ") +
      MUTED("V") +
      INK(String(state.suggestedBetter.speedOutOf10)) +
      FAINT("/10");
  }
  const versionPart = FAINT(`v${VERSION}`);
  const leftLen = visibleLen(phaseStr);
  const rightLen = visibleLen(versionPart);
  const padding = Math.max(2, cols - leftLen - rightLen);
  const line3 = phaseStr + " ".repeat(padding) + versionPart;

  return [rule, line1, line2, line3];
}

function scheduleRender(): void {
  // Émet un 'change' — StatusLine component re-render.
  emitter.emit("change");
}

export function initStatusBar(): void {
  if (enabled) return;
  enabled = true;
  state.cwd = process.cwd();
  // teardown au exit Node (normal ou forcé). Suffisant pour nettoyer
  // le status bar — pas besoin de handlers SIGINT/SIGTERM agressifs.
  //
  // IMPORTANT : on ne pose PAS de handler SIGINT qui call process.exit.
  // Inquirer (picker @inquirer/search dans /model) émet SIGINT quand
  // l'user appuie Ctrl-C pour cancel le picker — si on exitait ici, on
  // tuerait tout le REPL au lieu de juste fermer le picker. Node et
  // readline gèrent Ctrl-C nativement (cancel ligne / double Ctrl-C quit).
  process.on("exit", teardownStatusBar);
}

export function teardownStatusBar(): void {
  if (!enabled) return;
  enabled = false;
}

export function updateStatus(partial: Partial<Segments>): void {
  Object.assign(state, partial);
  scheduleRender();
}

export function setSessionTotals(inTotal: number, outTotal: number): void {
  state.sessionInTotal = inTotal;
  state.sessionOutTotal = outTotal;
  scheduleRender();
}

export function getStatus(): Readonly<Segments> {
  return { ...state };
}

export function resetTurn(): void {
  state.tokensIn = undefined;
  state.tokensOut = undefined;
  state.toolName = undefined;
  state.waitingMsRemaining = undefined;
  state.phase = "idle";
  scheduleRender();
}

