import { chalk } from "./logger.js";
import { getGitInfo } from "./git-info.js";

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
}

const state: Segments = { phase: "idle" };
let enabled = false;
// Nombre de lignes actuellement occupées par le status à l'écran. 0 si caché.
let visibleRows = 0;
let lastRenderAt = 0;
let pendingRender: NodeJS.Timeout | null = null;
// Flag : pendant le streaming, on ne repush PAS le status à chaque delta
// (sinon flicker). On le push après le dernier delta.
let suspended = false;

const STATUS_LINES = 4; // rule + 3 info lines
const RENDER_THROTTLE_MS = 120;
const VERSION = "0.1.0";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "idle",
  thinking: "thinking…",
  streaming: "streaming",
  "waiting-quota": "waiting quota",
  "executing-tool": "tool",
  compacting: "compacting…",
  offline: "offline",
};

const PHASE_SYM: Record<Phase, string> = {
  idle: "·",
  thinking: "●",
  streaming: "●",
  "waiting-quota": "⏳",
  "executing-tool": "◆",
  compacting: "↻",
  offline: "○",
};

const PHASE_COLOR: Record<Phase, (s: string) => string> = {
  idle: chalk.hex("#8a8270"),
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

function cleanProvider(name: string): string {
  const m = /^http\((.+)\)$/.exec(name);
  return m ? m[1] : name;
}

function contextWindowFor(model: string): number {
  const m = cleanProvider(model).toLowerCase();
  if (m.includes("large")) return 128_000;
  if (m.includes("medium")) return 128_000;
  if (m.includes("small")) return 32_000;
  if (m.includes("codestral")) return 256_000;
  return 128_000;
}

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
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 2) return ".../" + parts.slice(-2).join("/");
  return ".../" + parts.slice(-2).join("/");
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

function renderBlock(cols: number): string[] {
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
    parts1.push(
      ACCENT("◆ ") +
        INK_BRIGHT.bold(cleanProvider(state.provider)) +
        FAINT(` (${ctxStr} ctx)`),
    );
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
  if (sessionTotal > 0) {
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
  const versionPart = FAINT(`v${VERSION}`);
  const leftLen = visibleLen(phaseStr);
  const rightLen = visibleLen(versionPart);
  const padding = Math.max(2, cols - leftLen - rightLen);
  const line3 = phaseStr + " ".repeat(padding) + versionPart;

  return [rule, line1, line2, line3];
}

// Efface le status block précédemment imprimé (si présent), laissant le
// curseur à la position d'avant le status. À appeler avant tout output
// pour que le output s'insère en amont du status.
export function hideStatus(): void {
  if (!enabled || !process.stdout.isTTY || visibleRows === 0) return;
  // Cursor up N lines (N = nombre de lignes occupées)
  process.stdout.write(`\r\x1b[${visibleRows}A\x1b[0J`);
  visibleRows = 0;
}

// Imprime (ou re-imprime) le status block à la position courante du curseur.
// Typiquement appelé juste après un output pour "rattacher" le status.
export function showStatus(): void {
  if (!enabled || !process.stdout.isTTY) return;
  if (suspended) return;
  const cols = Math.min(process.stdout.columns ?? 80, 140);
  const lines = renderBlock(cols);
  // 1 blank line + STATUS_LINES
  process.stdout.write("\n");
  for (const line of lines) {
    process.stdout.write(line + "\n");
  }
  visibleRows = STATUS_LINES + 1;
  lastRenderAt = Date.now();
}

// Re-render : hide + show en séquence. Throttlé pour éviter le flicker
// pendant le streaming (on appelle updateStatus à chaque delta).
function scheduleRender(): void {
  if (!enabled || suspended) return;
  const now = Date.now();
  const sinceLast = now - lastRenderAt;
  if (sinceLast >= RENDER_THROTTLE_MS) {
    if (pendingRender) {
      clearTimeout(pendingRender);
      pendingRender = null;
    }
    hideStatus();
    showStatus();
  } else if (!pendingRender) {
    pendingRender = setTimeout(() => {
      pendingRender = null;
      hideStatus();
      showStatus();
    }, RENDER_THROTTLE_MS - sinceLast);
  }
}

// Suspend le rendu (pour qu'un output externe ne soit pas "refreshé" par
// notre re-render). Pendant suspend, updateStatus n'appelle pas showStatus.
export function suspendStatus(): void {
  suspended = true;
  hideStatus();
}

export function resumeStatus(): void {
  suspended = false;
  showStatus();
}

export function initStatusBar(): void {
  if (enabled) return;
  enabled = true;
  state.cwd = process.cwd();
  process.on("exit", teardownStatusBar);
  process.on("SIGINT", () => {
    teardownStatusBar();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    teardownStatusBar();
    process.exit(143);
  });
}

export function teardownStatusBar(): void {
  if (!enabled) return;
  hideStatus();
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

// Compat no-op (anciennement utilisé pour le countdown wait, remplacé par
// la phase "waiting-quota" dans le status block).
export function transientStatus(_msg: string): void {
  /* no-op */
}

// Compat : appelé par AgentLoop en fin de turn, le status est déjà sticky.
// Force un refresh explicite.
export function printStatusBlock(): void {
  scheduleRender();
}
