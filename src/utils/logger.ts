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
  // Mini séparateur entre blocs (ex: après /help, avant une nouvelle section).
  rule: () => console.log(ATH.inkFaint("─".repeat(40))),
  // Kicker micro-typo en couleur (sans règle), pour une section inline.
  kicker: (label: string) => ATH.inkFaint.bold(label.toUpperCase()),
  // Helpers bruts pour cas spéciaux (URLs clickables, tokens partiels masqués).
  accent: ATH.accent,
  accentSoft: ATH.accentSoft,
  ink: ATH.ink,
  inkMuted: ATH.inkMuted,
  inkFaint: ATH.inkFaint,
};

export { chalk };
