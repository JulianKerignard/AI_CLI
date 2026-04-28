import { EventEmitter } from "node:events";
import { sep } from "node:path";
import { chalk } from "./logger.js";
import { getGitInfo } from "./git-info.js";
import {
  cleanProvider as sharedCleanProvider,
  contextWindowFor as sharedContextWindowFor,
} from "../lib/context-window.js";
import { c, symbols } from "../ui/theme.js";

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
//   12k/128k ██░░░░░░░░ 9% ctx · 5h ░░░░ 0/500 0% · bucket 2/3
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
  // Coût "incompressible" de chaque requête : system prompt + schémas
  // des tools. Pushé par l'agent loop après chaque réponse. Le render
  // du ctx soustrait ce baseline pour afficher "conv only / max conv".
  baselineTokens?: number;
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

const STATUS_LINES = 2; // densité Claude Code/OpenCode : tout en 2 lignes
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

// Sur Windows hors Windows Terminal (conhost legacy, cmd.exe), beaucoup de
// code points Unicode ne s'affichent pas. WT_SESSION est set uniquement
// par Windows Terminal. Fallback ASCII si on détecte conhost/cmd.
const IS_LEGACY_CONSOLE =
  process.platform === "win32" && !process.env.WT_SESSION;

// Phase symbols : `executing-tool` utilise `▲` (symbols.phaseTool) pour
// éviter la collision avec le `◆` du logger qui marque maintenant
// uniquement les appels d'outils dans l'historique. `streaming` et
// `thinking` restent `●` (le rendu animé est géré par ANIM_FRAMES).
const PHASE_SYM: Record<Phase, string> = IS_LEGACY_CONSOLE
  ? {
      idle: ".",
      loading: "~",
      thinking: "*",
      streaming: "*",
      "waiting-quota": "...",
      "executing-tool": symbols.phaseTool,
      compacting: "~",
      offline: "o",
    }
  : {
      idle: "·",
      loading: "↻",
      thinking: "●",
      streaming: "●",
      "waiting-quota": "⏳",
      "executing-tool": symbols.phaseTool,
      compacting: "↻",
      offline: "○",
    };

// Frames d'animation par phase. Tickées à TICK_INTERVAL_MS quand l'agent
// travaille (cf. ANIMATED_PHASES). Désactivées sur conhost legacy (pas de
// support Unicode) — fallback sur PHASE_SYM statique.
// `executing-tool` anime sur ▲▼ pour rester sur la sémantique "phase"
// disambiguée du logger ◆. Le ◆ du logger reste mono-sens "appel d'outil
// dans l'historique".
const ANIM_FRAMES: Partial<Record<Phase, string[]>> = IS_LEGACY_CONSOLE
  ? {}
  : {
      thinking: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
      streaming: ["●", "◐", "◑", "◒", "◓", "◔", "◕"],
      loading: ["◜", "◠", "◝", "◞", "◡", "◟"],
      "executing-tool": ["▲", "▴", "△", "▴"],
      compacting: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
      "waiting-quota": ["⏳", "⌛"],
    };

const ANIMATED_PHASES = new Set<Phase>([
  "thinking",
  "streaming",
  "loading",
  "executing-tool",
  "compacting",
  "waiting-quota",
]);

const TICK_INTERVAL_MS = 100;
let frame = 0;
let tickTimer: NodeJS.Timeout | null = null;

function startTick(): void {
  if (tickTimer) return;
  if (!ANIMATED_PHASES.has(state.phase)) return;
  tickTimer = setInterval(() => {
    frame = (frame + 1) % 1_000_000;
    emitter.emit("change");
  }, TICK_INTERVAL_MS);
  // unref : laisse process.exit terminer même si le timer est encore actif.
  tickTimer.unref?.();
}

function stopTick(): void {
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

function phaseSymbol(phase: Phase): string {
  const frames = ANIM_FRAMES[phase];
  if (!frames || frames.length === 0) return PHASE_SYM[phase];
  return frames[frame % frames.length];
}

// Étoile clignotante pour la suggestion "meilleur modèle". 3 frames, cycle lent.
const STAR_FRAMES = IS_LEGACY_CONSOLE ? ["*"] : ["★", "✦", "✧", "✦"];
function starSymbol(): string {
  return STAR_FRAMES[Math.floor(frame / 3) % STAR_FRAMES.length];
}

// Glyphes utilisés dans le rendu (◆, ┤├, etc.) — versions ASCII pour conhost.
const GLYPH = IS_LEGACY_CONSOLE
  ? { diamond: "#", sepLine: "-", midDot: ".", arrowUp: "^", arrowDown: "v", star: "*" }
  : { diamond: "◆", sepLine: "─", midDot: "·", arrowUp: "↑", arrowDown: "↓", star: "★" };

const PHASE_COLOR: Record<Phase, (s: string) => string> = {
  idle: chalk.hex(c.inkDim),
  loading: chalk.hex(c.info),
  thinking: chalk.hex(c.accentSoft),
  streaming: chalk.hex(c.accent),
  "waiting-quota": chalk.hex(c.danger),
  "executing-tool": chalk.hex(c.accentSoft),
  compacting: chalk.hex(c.inkMuted),
  offline: chalk.hex(c.inkDim),
};

const FAINT = chalk.hex(c.inkFaint);
const MUTED = chalk.hex(c.inkDim);
const INK = chalk.hex(c.inkMuted);
const INK_BRIGHT = chalk.hex(c.ink);
const ACCENT = chalk.hex(c.accent);
const ACCENT_SOFT = chalk.hex(c.accentSoft);
const DANGER = chalk.hex(c.danger);
const SUCCESS = chalk.hex(c.success);
const TEAL = chalk.hex(c.info);

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
  // Refonte façon Claude Code / OpenCode : 2 lignes denses, pas de rule
  // décorative ni de tag de session permanent (les deux étaient bruyants
  // et redondants — le model+mode suffisent à identifier la session).
  // Q/V scoring retiré (info de niche, pas critique au quotidien — reste
  // accessible via /best). Bucket retiré (info trompeuse hardcodée).
  //
  // Layout cible :
  //   ◆ mistral-large 128k · ~/proj on develop · ↑1.2k ↓456 · 2% ctx · 12/500
  //   · idle                                                 ⎔ plan  v0.1.0

  const parts1: string[] = [];

  if (state.provider) {
    const ctxWin = state.contextWindow ?? contextWindowFor(state.provider);
    const ctxStr =
      ctxWin >= 1_000_000 ? `${ctxWin / 1_000_000}M` : `${ctxWin / 1_000}k`;
    // Le diamant pulse en cadence avec le tick global quand l'agent
    // streame ou exécute un tool — signe de vie discret.
    const diamondColor =
      state.phase === "streaming" || state.phase === "executing-tool"
        ? frame % 2 === 0
          ? ACCENT
          : ACCENT_SOFT
        : ACCENT;
    parts1.push(
      diamondColor(GLYPH.diamond + " ") +
        INK_BRIGHT.bold(cleanProvider(state.provider)) +
        FAINT(" " + ctxStr),
    );
  }

  // cwd + branch combinés en un seul segment (avant : 2 segments avec
  // séparateur — verbeux pour info de localisation simple).
  if (state.cwd) {
    const git = getGitInfo(state.cwd);
    let loc = MUTED(shortCwd(state.cwd));
    if (git?.branch) {
      loc += FAINT(" on ") + ACCENT_SOFT.italic(git.branch);
    }
    if (git && (git.additions > 0 || git.deletions > 0)) {
      loc +=
        " " +
        SUCCESS(`+${git.additions}`) +
        FAINT("/") +
        DANGER(`-${git.deletions}`);
    }
    parts1.push(loc);
  }

  // Tokens ↑↓ : 1 segment compact si présent.
  const inK = state.tokensIn ?? 0;
  const outK = state.tokensOut ?? 0;
  if (inK > 0 || outK > 0) {
    parts1.push(
      MUTED(GLYPH.arrowUp) +
        INK(compact(inK)) +
        " " +
        MUTED(GLYPH.arrowDown) +
        INK(compact(outK)),
    );
  }

  // Ctx % : compact, sans micro-bar (qui ne tenait pas sur petits
  // terminaux). Couleur selon seuil : >80% danger, >60% warn, sinon dim.
  const currentCtx = inK + outK;
  const ctxWindow =
    state.contextWindow ??
    contextWindowFor(state.provider ?? "mistral-large-latest");
  const baseline = state.baselineTokens ?? 0;
  if (currentCtx > 0) {
    const effectiveMax = Math.max(1, ctxWindow - baseline);
    const convUsed = Math.max(0, currentCtx - baseline);
    const pct = Math.min(1, convUsed / effectiveMax);
    const pctNum = Math.round(pct * 100);
    const ctxColor = pct >= 0.8 ? DANGER : pct >= 0.6 ? ACCENT_SOFT : MUTED;
    parts1.push(ctxColor(`${pctNum}%`) + FAINT(" ctx"));
  }

  // Quota crédits 5h : compact `12/500 · 3h` quand reset visible.
  if (state.quotaUsed !== undefined && state.quotaLimit) {
    const pct = state.quotaUsed / state.quotaLimit;
    const color = pct >= 0.9 ? DANGER : pct >= 0.7 ? ACCENT_SOFT : MUTED;
    let q = color(`${state.quotaUsed}/${state.quotaLimit}`);
    if (state.resetAt) q += FAINT(" ⟳") + FAINT(formatResetShort(state.resetAt));
    parts1.push(q);
  }

  const softSep = FAINT("  ·  ");
  const line1 = parts1.join(softSep);

  // Ligne 2 : phase à gauche, mode + version à droite, justifié.
  let phaseStr = PHASE_COLOR[state.phase](
    phaseSymbol(state.phase) + " " + PHASE_LABEL[state.phase],
  );
  if (state.phase === "executing-tool" && state.toolName) {
    phaseStr += MUTED(" " + state.toolName);
  }
  if (state.phase === "waiting-quota" && state.waitingMsRemaining !== undefined) {
    const s = Math.max(1, Math.ceil(state.waitingMsRemaining / 1000));
    phaseStr += MUTED(` ${s}s`);
  }
  // Suggestion "meilleur modèle" — affichée discrètement à droite du
  // phase label si présente.
  if (state.suggestedBetter) {
    const parts = state.suggestedBetter.id.split("/");
    const shortId = parts[parts.length - 1] || state.suggestedBetter.id;
    phaseStr += FAINT("  ·  ") + SUCCESS(starSymbol() + " ") + ACCENT_SOFT(shortId);
  }

  // Permission mode — toujours visible (default inclus) avec puce de couleur.
  let modePart = "";
  if (state.permissionMode === "bypass") {
    modePart =
      chalk.hex(c.danger).bold((IS_LEGACY_CONSOLE ? "! " : "⚠ ") + "bypass") +
      "  ";
  } else if (state.permissionMode === "plan") {
    modePart =
      ACCENT_SOFT((IS_LEGACY_CONSOLE ? "[P] " : "⎔ ") + "plan") + "  ";
  } else if (state.permissionMode === "accept-edits") {
    modePart =
      SUCCESS((IS_LEGACY_CONSOLE ? "[E] " : "✓ ") + "accept-edits") + "  ";
  } else if (state.permissionMode) {
    modePart =
      MUTED((IS_LEGACY_CONSOLE ? "[D] " : "○ ") + state.permissionMode) +
      "  ";
  }
  const versionPart = FAINT(`v${VERSION}`);
  const leftLen = visibleLen(phaseStr);
  const rightPart = modePart + versionPart;
  const rightLen = visibleLen(rightPart);
  const padding = Math.max(2, cols - leftLen - rightLen);
  const line2 = phaseStr + " ".repeat(padding) + rightPart;

  return [line1, line2];
}

function scheduleRender(): void {
  // Émet un 'change' — StatusLine component re-render.
  emitter.emit("change");
  // Synchronise le tick d'animation avec la phase courante : on ne paie
  // 100 ms de re-render qu'aux moments où l'agent travaille.
  if (ANIMATED_PHASES.has(state.phase)) startTick();
  else stopTick();
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
  stopTick();
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

export function resetTurn(): void {
  state.tokensIn = undefined;
  state.tokensOut = undefined;
  state.toolName = undefined;
  state.waitingMsRemaining = undefined;
  state.phase = "idle";
  scheduleRender();
}

