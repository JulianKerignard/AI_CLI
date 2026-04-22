import chalk from "chalk";

// Palette Athenaeum portée en terminal :
// - accent orange cuivré   #e27649 → chalk.hex("#e27649") (utilisateur/prompt/hero)
// - accent-soft            #ec9470 → highlights secondaires
// - ink                    #f6f1e8 → texte principal (chalk default)
// - ink-muted              #bdb3a1 → commentaires, hints, dim
// - ink-faint              #8a8270 → meta très discret
// - success                #7fa670 → confirmations
// - danger                 #c76a5f → erreurs
// chalk.hex() fallback true-color ; dégradé auto en 256 colors sinon.

const ATH = {
  accent: chalk.hex("#e27649"),
  accentSoft: chalk.hex("#ec9470"),
  accentDeep: chalk.hex("#b85a31"),
  ink: chalk.hex("#f6f1e8"),
  inkMuted: chalk.hex("#bdb3a1"),
  inkFaint: chalk.hex("#8a8270"),
  success: chalk.hex("#7fa670"),
  danger: chalk.hex("#c76a5f"),
};

// Symboles discrets, cohérents avec le look éditorial Athenaeum (pas d'emojis,
// glyphes ASCII/Unicode sobres). Cadré pour lisibilité en mono 14px terminal.
const SYM = {
  info: "›",
  warn: "!",
  error: "✗",
  user: "»",
  assistant: "●",
  tool: "◆",
  toolOut: "│",
  kicker: "─",
};

// Compactage de nombres type 1234 → "1.2k", 15678 → "15.7k".
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

// Formate un instant ISO en "dans Xh Ym" relatif. Null si le quota ne reset
// pas (pas d'ancienne activité dans la fenêtre).
function formatResetIn(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return "bientôt";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `dans ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `dans ${h}h` : `dans ${h}h ${m}m`;
}

export interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
  windowHours: number;
  resetAt?: string;
  weight?: number;
}

// Normalise le nom de provider : "http(mistral-large-latest)" → "mistral-large-latest".
// Laisse les noms simples tels quels ("demo", "openai(gpt-4)", etc.).
function cleanProviderName(name: string): string {
  const m = /^http\((.+)\)$/.exec(name);
  return m ? m[1] : name;
}

// Status line style Claude Code : une ligne compacte avec segments séparés par
// une barre verticale subtile. Affiche modèle, tokens ↑↓, micro-bar de quota,
// crédits utilisés/limite, temps avant reset.
//
// Exemple :
//    mistral-large-latest  │  ↑ 1.2k  ↓ 456  │  █████░░░░  12/500  │  reset 3h 42m
export function formatTurnStatus(
  inputTokens: number,
  outputTokens: number,
  quota?: QuotaInfo,
  providerName?: string,
): string {
  const sep = ATH.inkFaint("  │  ");
  const parts: string[] = [];

  if (providerName) {
    parts.push(ATH.inkMuted(cleanProviderName(providerName)));
  }

  if (inputTokens > 0 || outputTokens > 0) {
    parts.push(
      ATH.inkFaint("↑ ") +
        ATH.inkMuted(compact(inputTokens)) +
        "  " +
        ATH.inkFaint("↓ ") +
        ATH.inkMuted(compact(outputTokens)),
    );
  }

  if (quota) {
    const pct = quota.used / quota.limit;
    const quotaColor =
      pct >= 0.9 ? ATH.danger : pct >= 0.7 ? ATH.accentSoft : ATH.accent;
    const barWidth = 10;
    const filled = Math.min(barWidth, Math.round(pct * barWidth));
    const bar =
      quotaColor("█".repeat(filled)) +
      ATH.inkFaint("░".repeat(barWidth - filled));
    parts.push(bar + "  " + quotaColor(`${quota.used}/${quota.limit}`));

    if (quota.resetAt) {
      parts.push(ATH.inkFaint("reset " + formatResetIn(quota.resetAt)));
    }
  }

  if (parts.length === 0) return "";
  return parts.join(sep);
}

// Bloc /usage : plusieurs lignes avec détail session cumulatif + quota.
export function formatQuotaStatus(
  session: { inputTokens: number; outputTokens: number; turns: number; toolCalls: number },
  quota?: QuotaInfo,
): string[] {
  const lines: string[] = [];
  lines.push(
    "  " +
      ATH.inkFaint.bold("SESSION") +
      "  " +
      ATH.ink(`${session.turns} turns`) +
      ATH.inkFaint(" · ") +
      ATH.ink(`${session.toolCalls} tool calls`),
  );
  lines.push(
    "  " +
      ATH.inkFaint.bold("TOKENS ") +
      "  " +
      ATH.ink(compact(session.inputTokens)) +
      ATH.inkFaint(" in · ") +
      ATH.ink(compact(session.outputTokens)) +
      ATH.inkFaint(" out · ") +
      ATH.ink(compact(session.inputTokens + session.outputTokens)) +
      ATH.inkFaint(" total"),
  );
  if (quota) {
    const pct = quota.used / quota.limit;
    const quotaColor =
      pct >= 0.9 ? ATH.danger : pct >= 0.7 ? ATH.accentSoft : ATH.accent;
    const barWidth = 20;
    const filled = Math.min(barWidth, Math.round(pct * barWidth));
    const bar =
      quotaColor("█".repeat(filled)) +
      ATH.inkFaint("░".repeat(barWidth - filled));
    lines.push(
      "  " +
        ATH.inkFaint.bold("QUOTA  ") +
        "  " +
        bar +
        "  " +
        quotaColor(`${quota.used}/${quota.limit}`) +
        ATH.inkFaint(` crédits · ${quota.windowHours}h window`),
    );
    if (quota.resetAt) {
      lines.push(
        "  " +
          ATH.inkFaint.bold("RESET  ") +
          "  " +
          ATH.inkMuted(formatResetIn(quota.resetAt)),
      );
    }
  } else {
    lines.push(
      "  " +
        ATH.inkFaint.bold("QUOTA  ") +
        "  " +
        ATH.inkFaint("(non disponible — envoie un message pour récupérer)"),
    );
  }
  return lines;
}

export const log = {
  info: (msg: string) => console.log(ATH.accent(SYM.info + "  ") + ATH.ink(msg)),
  warn: (msg: string) =>
    console.log(ATH.accentSoft(SYM.warn + "  ") + ATH.ink(msg)),
  error: (msg: string) =>
    console.log(ATH.danger(SYM.error + "  ") + ATH.ink(msg)),
  dim: (msg: string) => console.log(ATH.inkMuted(msg)),
  faint: (msg: string) => console.log(ATH.inkFaint(msg)),
  success: (msg: string) =>
    console.log(ATH.success(SYM.info + "  ") + ATH.ink(msg)),
  user: (msg: string) => console.log(ATH.accent.bold(SYM.user + " ") + ATH.ink(msg)),
  assistant: (msg: string) =>
    console.log(
      ATH.accent(SYM.assistant + " ") +
        ATH.ink(msg.replace(/\n/g, "\n  ")),
    ),
  // Prefix pour le streaming assistant : le texte vient en deltas juste après.
  // Pas de \n à la fin — AgentLoop imprime les deltas directement, puis ajoute
  // un \n final quand le stream se termine.
  streamPrefix: () => ATH.accent(SYM.assistant + " "),
  tool: (name: string, detail: string) =>
    console.log(
      ATH.accentSoft(SYM.tool + " ") +
        ATH.accentSoft.bold(name) +
        " " +
        ATH.inkFaint(detail),
    ),
  toolResult: (text: string) => {
    const trimmed = text.length > 400 ? text.slice(0, 400) + "…" : text;
    const lines = trimmed.split("\n");
    for (const line of lines) {
      console.log(ATH.inkFaint(SYM.toolOut + " ") + ATH.inkMuted(line));
    }
  },
  banner: (title: string) => {
    console.log();
    // Kicker Athenaeum style : uppercase, spacing, couleur discrète + règle.
    console.log(
      ATH.accent(SYM.kicker + " ") +
        ATH.inkMuted.bold(title.toUpperCase()) +
        "  " +
        ATH.inkFaint(SYM.kicker.repeat(Math.max(4, 40 - title.length))),
    );
  },
  // Status bar style Claude Code : fine règle au-dessus, une ligne compacte
  // avec segments, fine règle en-dessous. Skippé si la chaîne est vide.
  status: (line: string) => {
    if (!line) return;
    const width = Math.min(process.stdout.columns || 80, 100);
    console.log();
    console.log(ATH.inkFaint("─".repeat(width)));
    console.log("  " + line);
    console.log(ATH.inkFaint("─".repeat(width)));
  },
  // Ligne one-shot de "waiting X for Mistral quota", effacée dès que la req
  // part. Utilise \r pour rester sur la même ligne (updated au fil du tick).
  // Quand `msg` est vide → efface la ligne (end of wait).
  waitingStatus: (msg: string) => {
    const out = process.stdout;
    if (!out.isTTY) return;
    if (msg === "") {
      out.write("\r\x1b[2K");
      return;
    }
    out.write(`\r\x1b[2K${msg}`);
  },
  // Mini séparateur entre blocs (ex: après /help, avant une nouvelle section).
  rule: () => console.log(ATH.inkFaint("─".repeat(40))),
  // Kicker micro-typo en couleur (sans règle), pour une section inline.
  kicker: (label: string) => ATH.inkFaint.bold(label.toUpperCase()),
  // Helpers bruts pour cas spéciaux (URLs clickables, tokens partiels masqués).
  accent: ATH.accent,
  accentSoft: ATH.accentSoft,
  danger: ATH.danger,
  ink: ATH.ink,
  inkMuted: ATH.inkMuted,
  inkFaint: ATH.inkFaint,
};

export { chalk };
