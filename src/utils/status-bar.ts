import { chalk } from "./logger.js";

// Status bar persistant façon tmux : reserved row au bas du terminal. Le
// contenu scrolle dans la région [1, rows-1], le status reste fixé à rows.
// Updates en temps réel sur le phase courant (thinking / streaming / waiting
// quota / executing tool), tokens, quota, provider.

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
  model?: string;
  phase: Phase;
  tokensIn?: number;
  tokensOut?: number;
  sessionInTotal?: number;
  sessionOutTotal?: number;
  quotaUsed?: number;
  quotaLimit?: number;
  resetAt?: string;
  waitingMsRemaining?: number;
  toolName?: string;
  bucketUsed?: number;
  bucketCapacity?: number;
}

const state: Segments = { phase: "idle" };
let enabled = false;
let lastRenderAt = 0;
let pendingRender: NodeJS.Timeout | null = null;

const RENDER_THROTTLE_MS = 80;

const PHASE_LABEL: Record<Phase, string> = {
  idle: "idle",
  thinking: "thinking…",
  streaming: "streaming",
  "waiting-quota": "waiting quota",
  "executing-tool": "tool",
  compacting: "compacting…",
  offline: "offline",
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
const ACCENT = chalk.hex("#e27649");
const DANGER = chalk.hex("#c76a5f");

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

function formatLine(cols: number): string {
  const sep = FAINT(" · ");
  const parts: string[] = [];

  // Phase indicator (left) — symbole + label avec couleur adaptée.
  const phaseSym =
    state.phase === "streaming" || state.phase === "thinking"
      ? "●"
      : state.phase === "waiting-quota"
        ? "⏳"
        : state.phase === "executing-tool"
          ? "◆"
          : state.phase === "compacting"
            ? "↻"
            : state.phase === "offline"
              ? "○"
              : "·";
  let phaseStr = PHASE_COLOR[state.phase](
    phaseSym + " " + PHASE_LABEL[state.phase],
  );
  if (state.phase === "executing-tool" && state.toolName) {
    phaseStr += MUTED(" " + state.toolName);
  }
  if (state.phase === "waiting-quota" && state.waitingMsRemaining !== undefined) {
    const s = Math.max(1, Math.ceil(state.waitingMsRemaining / 1000));
    phaseStr += MUTED(` ${s}s`);
  }
  parts.push(phaseStr);

  // Provider + model.
  if (state.provider) {
    parts.push(INK(cleanProvider(state.provider)));
  }

  // Tokens turn (le turn courant) : ↑in ↓out.
  if ((state.tokensIn ?? 0) > 0 || (state.tokensOut ?? 0) > 0) {
    parts.push(
      MUTED("↑") +
        INK(compact(state.tokensIn ?? 0)) +
        "  " +
        MUTED("↓") +
        INK(compact(state.tokensOut ?? 0)),
    );
  }

  // Quota : bar mini + ratio. Rouge si >90%.
  if (state.quotaUsed !== undefined && state.quotaLimit) {
    const pct = state.quotaUsed / state.quotaLimit;
    const color = pct >= 0.9 ? DANGER : pct >= 0.7 ? chalk.hex("#ec9470") : ACCENT;
    const width = 8;
    const filled = Math.min(width, Math.round(pct * width));
    const bar =
      color("█".repeat(filled)) + FAINT("░".repeat(width - filled));
    parts.push(bar + " " + color(`${state.quotaUsed}/${state.quotaLimit}`));
  }

  // Bucket rate limiter (local).
  if (state.bucketUsed !== undefined && state.bucketCapacity) {
    parts.push(
      MUTED("bucket ") +
        INK(`${state.bucketUsed}/${state.bucketCapacity}`),
    );
  }

  let line = parts.join(sep);
  // Truncate si trop long (pas de wrap dans un status bar).
  // Approximation : on strip les ANSI et on compte les chars visibles.
  const visible = line.replace(/\x1b\[[0-9;]*m/g, "");
  if (visible.length > cols - 2) {
    // Fallback : version courte
    line = parts.slice(0, 3).join(sep);
  }
  return line;
}

function writeStatus(): void {
  if (!enabled || !process.stdout.isTTY) return;
  const rows = process.stdout.rows ?? 24;
  const cols = process.stdout.columns ?? 80;
  const line = formatLine(cols);
  // Save cursor → move to row `rows` col 1 → clear line → write status → restore
  process.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K${line}\x1b8`);
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
  // Scroll region [1, rows-1], bottom row = status
  process.stdout.write(`\x1b[1;${rows - 1}r`);
  // Place cursor juste au-dessus du status pour que les prochains outputs
  // scrollent proprement.
  process.stdout.write(`\x1b[${rows - 1};1H`);
  scheduleRender();
}

export function initStatusBar(): void {
  if (enabled || !process.stdout.isTTY) return;
  enabled = true;
  resizeScrollRegion();
  process.stdout.on("resize", resizeScrollRegion);
  // Teardown sur toutes les voies de sortie.
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
    // Reset scroll region au default (full screen).
    process.stdout.write(`\x1b[r`);
    const rows = process.stdout.rows ?? 24;
    // Clear status row puis move cursor à la fin du terminal pour que le
    // prompt shell de l'utilisateur atterrisse en bas sans ligne orpheline.
    process.stdout.write(`\x1b[${rows};1H\x1b[2K`);
  } catch {
    /* noop */
  }
}

export function updateStatus(partial: Partial<Segments>): void {
  Object.assign(state, partial);
  scheduleRender();
}

export function getStatus(): Readonly<Segments> {
  return { ...state };
}

// Helper pour resetter proprement l'état turn (appelé entre deux user inputs).
export function resetTurn(): void {
  state.tokensIn = undefined;
  state.tokensOut = undefined;
  state.toolName = undefined;
  state.waitingMsRemaining = undefined;
  state.phase = "idle";
  scheduleRender();
}
