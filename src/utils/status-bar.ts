import { chalk } from "./logger.js";
import { basename } from "node:path";
import { getGitInfo } from "./git-info.js";

// Status block multi-lignes persistent au bas du terminal (style Claude Code).
// Reserved 4 rows + 1 rule au-dessus :
//
//   ─────────────────────────────────────────────────────   [ session-tag ]
//
//   ◆ model (context) · /cwd · branch  │  ↑tokens_in ↓tokens_out  │  +add -del
//   562k/1.0M ████████░░  56% · quota ████░░ 12/500  · bucket 2/3 · cold
//   ►► streaming · Ls(src)                                    v0.1.0

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
  // Estimation context window selon model (avec fallback 128k).
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
  // Tag affiché en haut à droite de la rule (style conv-name de Claude).
  sessionTag?: string;
}

const state: Segments = { phase: "idle" };
let enabled = false;
let lastRenderAt = 0;
let pendingRender: NodeJS.Timeout | null = null;

// Nombre de lignes reservées pour le status block (rule incluse).
// La rule du haut + 1 ligne vide + 3 lignes d'info + 1 ligne vide = 5.
const STATUS_ROWS = 4;
const RENDER_THROTTLE_MS = 80;

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
// Teal-ish pour le tag session de la rule (distinct de l'accent orange).
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

// Heuristique context window selon model name.
function contextWindowFor(model: string): number {
  const m = cleanProvider(model).toLowerCase();
  if (m.includes("large")) return 128_000;
  if (m.includes("medium")) return 128_000;
  if (m.includes("small")) return 32_000;
  if (m.includes("codestral")) return 256_000;
  return 128_000;
}

// Barre de progression ASCII : ▓ filled, ░ empty, taille configurable.
function renderBar(
  pct: number,
  width: number,
  color: (s: string) => string = ACCENT,
): string {
  const filled = Math.max(0, Math.min(width, Math.round(pct * width)));
  return color("█".repeat(filled)) + FAINT("░".repeat(width - filled));
}

// Truncate chemin cwd en `.../parent/dir` si trop long.
function shortCwd(cwd: string, max = 35): string {
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

// Strip ANSI codes pour mesurer la largeur visible d'une ligne.
function visibleLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// Padding à droite jusqu'à une largeur donnée (compté sur visible chars).
function padToCols(line: string, cols: number): string {
  const vis = visibleLen(line);
  if (vis >= cols) return line;
  return line + " ".repeat(cols - vis);
}

interface RenderedLines {
  rule: string;
  line1: string;
  line2: string;
  line3: string;
}

function renderLines(cols: number): RenderedLines {
  // Rule avec tag à droite. Ex: ─────────────  ┤ tag ├
  const tag = state.sessionTag ?? cleanProvider(state.provider ?? "");
  const tagText = tag ? ` ${tag} ` : "";
  const tagBox = tag
    ? chalk.bgHex("#245454").hex("#f6f1e8")(tagText)
    : "";
  const ruleLen = Math.max(0, cols - visibleLen(tagBox) - 2);
  const rule = TEAL("─".repeat(ruleLen)) + (tagBox ? "  " + tagBox : "");

  // Line 1 : ◆ model (ctx) · cwd · branch │ ↑in ↓out │ +add -del
  const parts1: string[] = [];
  if (state.provider) {
    const ctxWin = state.contextWindow ?? contextWindowFor(state.provider);
    const ctxStr = ctxWin >= 1_000_000 ? `${ctxWin / 1_000_000}M` : `${ctxWin / 1_000}k`;
    parts1.push(
      ACCENT("◆ ") +
        INK_BRIGHT.bold(cleanProvider(state.provider)) +
        FAINT(` (${ctxStr} ctx)`),
    );
  }
  if (state.cwd) {
    parts1.push(MUTED(shortCwd(state.cwd)));
  }
  const git = state.cwd ? getGitInfo(state.cwd) : null;
  if (git?.branch) {
    parts1.push(INK("on ") + ACCENT_SOFT.italic(git.branch));
  }

  // Tokens turn (séparateur vertical style Claude).
  const tokenSegs: string[] = [];
  if ((state.tokensIn ?? 0) > 0) {
    tokenSegs.push(MUTED("↑") + INK(compact(state.tokensIn!)));
  }
  if ((state.tokensOut ?? 0) > 0) {
    tokenSegs.push(MUTED("↓") + INK(compact(state.tokensOut!)));
  }
  if (tokenSegs.length > 0) {
    parts1.push(tokenSegs.join(" "));
  }

  if (git && (git.additions > 0 || git.deletions > 0)) {
    parts1.push(
      SUCCESS(`+${git.additions}`) + " " + DANGER(`-${git.deletions}`),
    );
  }

  const sep = FAINT("  │  ");
  const softSep = FAINT("  ·  ");
  const line1 = parts1
    .slice(0, 3)
    .join(softSep)
    + (parts1.length > 3 ? sep + parts1.slice(3).join(sep) : "");

  // Line 2 : context bar · quota bar · bucket
  const parts2: string[] = [];

  // Context : tokens session totaux / context window
  const sessionTotal = (state.sessionInTotal ?? 0) + (state.sessionOutTotal ?? 0);
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

  // Quota : bucket 5h côté serveur
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

  // Rate limiter bucket client
  if (state.bucketUsed !== undefined && state.bucketCapacity) {
    const coldBadge = state.bucketCold ? " " + DANGER("cold") : "";
    parts2.push(
      MUTED("bucket ") +
        INK(`${state.bucketUsed}/${state.bucketCapacity}`) +
        coldBadge,
    );
  }

  const line2 = parts2.join(FAINT("  ·  "));

  // Line 3 : phase + tool + version à droite
  let phaseStr = PHASE_COLOR[state.phase](
    PHASE_SYM[state.phase] + " " + PHASE_LABEL[state.phase],
  );
  if (state.phase === "executing-tool" && state.toolName) {
    phaseStr += MUTED(" " + state.toolName);
  }
  if (
    state.phase === "waiting-quota" &&
    state.waitingMsRemaining !== undefined
  ) {
    const s = Math.max(1, Math.ceil(state.waitingMsRemaining / 1000));
    phaseStr += MUTED(` ${s}s`);
  }

  const versionPart = FAINT(`v${VERSION}`);
  const line3Left = phaseStr;
  const leftLen = visibleLen(line3Left);
  const rightLen = visibleLen(versionPart);
  const padding = Math.max(2, cols - leftLen - rightLen);
  const line3 = line3Left + " ".repeat(padding) + versionPart;

  return { rule, line1, line2, line3 };
}

function writeStatus(): void {
  if (!enabled || !process.stdout.isTTY) return;
  const rows = process.stdout.rows ?? 24;
  const cols = process.stdout.columns ?? 80;
  if (rows < STATUS_ROWS + 5) return; // terminal trop petit

  const { rule, line1, line2, line3 } = renderLines(cols);

  // Save cursor → écrit les 4 lignes (rule + 3 data lines) depuis la base.
  // Ordre : rule = rows-3, line1 = rows-2, line2 = rows-1, line3 = rows.
  const buf = [
    `\x1b7`, // save cursor
    `\x1b[${rows - STATUS_ROWS + 1};1H`,
    `\x1b[2K`,
    padToCols(rule, cols),
    `\r\n`,
    `\x1b[2K`,
    padToCols(line1, cols),
    `\r\n`,
    `\x1b[2K`,
    padToCols(line2, cols),
    `\r\n`,
    `\x1b[2K`,
    padToCols(line3, cols),
    `\x1b8`, // restore cursor
  ].join("");

  process.stdout.write(buf);
  lastRenderAt = Date.now();
}

function scheduleRender(): void {
  if (!enabled) return;
  const now = Date.now();
  const sinceLast = now - lastRenderAt;
  if (sinceLast >= RENDER_THROTTLE_MS) {
    if (pendingRender) {
      clearTimeout(pendingRender);
      pendingRender = null;
    }
    writeStatus();
  } else if (!pendingRender) {
    pendingRender = setTimeout(() => {
      pendingRender = null;
      writeStatus();
    }, RENDER_THROTTLE_MS - sinceLast);
  }
}

function resizeScrollRegion(): void {
  if (!enabled || !process.stdout.isTTY) return;
  const rows = process.stdout.rows ?? 24;
  // Scroll region [1, rows-STATUS_ROWS]. Le status occupe les 4 dernières lignes.
  process.stdout.write(`\x1b[1;${Math.max(1, rows - STATUS_ROWS)}r`);
  // Place cursor juste au-dessus du status (dernière ligne de scroll region).
  process.stdout.write(`\x1b[${Math.max(1, rows - STATUS_ROWS)};1H`);
  scheduleRender();
}

export function initStatusBar(): void {
  if (enabled || !process.stdout.isTTY) return;
  enabled = true;
  state.cwd = process.cwd();
  resizeScrollRegion();
  process.stdout.on("resize", resizeScrollRegion);
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
  enabled = false;
  try {
    process.stdout.write(`\x1b[r`);
    const rows = process.stdout.rows ?? 24;
    // Clear les 4 lignes status, move cursor tout en bas.
    for (let i = 0; i < STATUS_ROWS; i++) {
      process.stdout.write(`\x1b[${rows - i};1H\x1b[2K`);
    }
    process.stdout.write(`\x1b[${rows};1H`);
  } catch {
    /* noop */
  }
}

export function updateStatus(partial: Partial<Segments>): void {
  Object.assign(state, partial);
  // Accumulate session totals automatically when tokens are updated.
  if (partial.tokensIn !== undefined && partial.sessionInTotal === undefined) {
    // Pas d'accum automatique — AgentLoop set sessionInTotal explicitement
    // quand un turn complet finit.
  }
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
