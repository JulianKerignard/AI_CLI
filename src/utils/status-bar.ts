import { chalk } from "./logger.js";
import { getGitInfo } from "./git-info.js";

// Status block multi-lignes style Claude Code, rendered INLINE après chaque
// turn complet. Pas de scroll region (trop fragile avec readline). Le block
// scrolle naturellement avec le reste du contenu.
//
//   ─────────────────────────────────────────────────────   ┤ session-tag ├
//   ◆ model (context) · /cwd · branch  │  ↑tokens_in ↓tokens_out  │  +add -del
//   562k/1.0M ████████░░  56% · quota ████░░ 12/500  · bucket 2/3 · cold
//   ● streaming · Ls(src)                                                 v0.1.0

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

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function renderBlock(cols: number): string[] {
  // Rule avec tag à droite
  const tag = state.sessionTag ?? cleanProvider(state.provider ?? "");
  const tagBox = tag
    ? chalk.bgHex("#245454").hex("#f6f1e8")(` ${tag} `)
    : "";
  const ruleLen = Math.max(0, cols - visibleLen(tagBox) - 2);
  const rule = TEAL("─".repeat(ruleLen)) + (tagBox ? "  " + tagBox : "");

  // Line 1 : model + cwd + branch + tokens + git diff
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

  // Line 2 : context + quota + bucket
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

  // Line 3 : phase + tool + version à droite
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

// ===== API publique =====

// Imprime le bloc status en output normal (scrolle avec le reste).
// Appelé après chaque turn assistant complet. Pas de cursor manipulation,
// pas de scroll region — 100% compatible avec readline.
export function printStatusBlock(): void {
  if (!process.stdout.isTTY) return;
  const cols = Math.min(process.stdout.columns ?? 80, 120);
  const lines = renderBlock(cols);
  console.log();
  for (const l of lines) console.log(l);
}

// Ligne de status transitoire une seule ligne (style " ⏳ waiting Xs"),
// effacée quand on appelle avec "". Utilise \r pour rester sur la ligne
// courante sans scroller.
export function transientStatus(msg: string): void {
  if (!process.stdout.isTTY) return;
  if (msg === "") {
    process.stdout.write("\r\x1b[2K");
    return;
  }
  process.stdout.write("\r\x1b[2K" + msg);
}

// Update interne du state. Déclenche éventuellement un transientStatus
// pendant les phases live (waiting-quota avec countdown).
export function updateStatus(partial: Partial<Segments>): void {
  Object.assign(state, partial);
  // Phase waiting-quota : countdown live sur une ligne transitoire.
  if (
    state.phase === "waiting-quota" &&
    state.waitingMsRemaining !== undefined
  ) {
    const sec = Math.max(1, Math.ceil(state.waitingMsRemaining / 1000));
    const label = state.toolName ? ` (${state.toolName})` : "";
    transientStatus(
      chalk.hex("#ec9470")("⏳ ") +
        chalk.hex("#bdb3a1")(
          `waiting ${sec}s for Mistral quota${label}…`,
        ),
    );
  } else if (partial.phase !== undefined || partial.waitingMsRemaining !== undefined) {
    // Clear transient si on sort de waiting
    if (state.phase !== "waiting-quota") transientStatus("");
  }
}

export function setSessionTotals(inTotal: number, outTotal: number): void {
  state.sessionInTotal = inTotal;
  state.sessionOutTotal = outTotal;
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
}

// Pas de scroll region, pas d'init nécessaire — API no-op gardée pour compat.
export function initStatusBar(): void {
  state.cwd = process.cwd();
}
export function teardownStatusBar(): void {
  transientStatus("");
}
