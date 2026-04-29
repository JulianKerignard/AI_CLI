// Décide si le mode TUI fullscreen (alt-screen) doit être activé. Tient
// compte du TTY, du conhost legacy Windows, des env vars opt-in/opt-out
// et de la dimension minimum du terminal.
//
// Conventions :
//   - AICLI_TUI=fullscreen           → opt-in fullscreen
//   - AICLI_NO_FULLSCREEN=1          → opt-out (force legacy même si flag)
//   - --tui=fullscreen / --tui=fs    → opt-in CLI (équivalent env var)
//   - !process.stdin.isTTY ||
//     !process.stdout.isTTY          → fallback legacy (pipe stdin/stdout, CI)
//   - Windows conhost legacy         → fallback legacy (alt-screen + Unicode KO)
//   - rows < 20 || cols < 60         → fallback legacy (terminal trop petit)
//
// Aujourd'hui le fullscreen reste opt-in (default OFF). Quand PR#3 sera
// mergée et stabilisée, on flippera le default à ON et l'AICLI_NO_FULLSCREEN
// deviendra le seul escape hatch.

const IS_LEGACY_CONSOLE =
  process.platform === "win32" && !process.env.WT_SESSION;

const MIN_COLS = 60;
const MIN_ROWS = 20;

export interface FullscreenDecision {
  enabled: boolean;
  reason: string;
}

// Parse minimal des args CLI pour --tui=fullscreen / --tui=fs / --tui=default.
// Retourne 'fullscreen' | 'default' | undefined (pas de flag passé).
export function parseTuiFlag(argv: readonly string[]): "fullscreen" | "default" | undefined {
  for (const a of argv) {
    const m = /^--tui=(.+)$/.exec(a);
    if (!m) continue;
    const v = m[1].toLowerCase();
    if (v === "fullscreen" || v === "fs") return "fullscreen";
    if (v === "default" || v === "legacy" || v === "off") return "default";
  }
  return undefined;
}

export function shouldUseFullscreen(
  argv: readonly string[] = process.argv.slice(2),
): FullscreenDecision {
  // Hors TTY : pas de fullscreen possible (pipe stdin/stdout, CI, redirect).
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { enabled: false, reason: "stdin/stdout not a TTY" };
  }
  // Conhost legacy Windows : alt-screen + Unicode partiel = mauvaise UX.
  if (IS_LEGACY_CONSOLE) {
    return { enabled: false, reason: "Windows conhost legacy" };
  }
  // Terminal trop petit pour le layout panneaux.
  const cols = process.stdout.columns ?? 0;
  const rows = process.stdout.rows ?? 0;
  if (cols < MIN_COLS || rows < MIN_ROWS) {
    return {
      enabled: false,
      reason: `terminal too small (${cols}×${rows}, min ${MIN_COLS}×${MIN_ROWS})`,
    };
  }
  // Opt-out explicite via env var.
  if (process.env.AICLI_NO_FULLSCREEN === "1") {
    return { enabled: false, reason: "AICLI_NO_FULLSCREEN=1" };
  }
  // Flag CLI explicite (--tui=default override env var).
  const cliFlag = parseTuiFlag(argv);
  if (cliFlag === "default") {
    return { enabled: false, reason: "--tui=default" };
  }
  if (cliFlag === "fullscreen") {
    return { enabled: true, reason: "--tui=fullscreen" };
  }
  // Env var opt-in.
  if (process.env.AICLI_TUI === "fullscreen") {
    return { enabled: true, reason: "AICLI_TUI=fullscreen" };
  }
  // Default : OFF tant que PR#3 (scroll virtuel) pas mergée.
  return { enabled: false, reason: "default (opt-in via --tui=fullscreen)" };
}
