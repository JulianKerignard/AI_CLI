import chalk from "chalk";
import { historyStore } from "../ui/history-store.js";
import { c, symbols } from "../ui/theme.js";

// Pousse une ligne déjà colorisée dans l'UI. Remplace les console.log
// de l'ancien logger — l'UI Ink affiche le texte via Static.
function ui(text: string, level: "info" | "warn" | "error" | "raw" = "raw"): void {
  historyStore.push({ type: level, text });
}

// Wrappers chalk autour de la palette `theme.ts`. Avant : 8 hex
// hardcodés en double dans cet objet ATH. Maintenant : single source of
// truth, juste un mapping chalk.hex(c.x).
const ATH = {
  accent: chalk.hex(c.accent),
  accentSoft: chalk.hex(c.accentSoft),
  accentDeep: chalk.hex(c.accentDeep),
  ink: chalk.hex(c.ink),
  inkMuted: chalk.hex(c.inkMuted),
  inkDim: chalk.hex(c.inkDim),
  inkFaint: chalk.hex(c.inkDim), // alias pour compat
  success: chalk.hex(c.success),
  danger: chalk.hex(c.danger),
};

// Symboles disambigués (cf. ui/theme.ts). info=• (avant ›, qui collisionnait
// avec le prompt InputBox). user=» et assistant=● restent inchangés
// (mono-sens). tool=◆ (mono-sens depuis la disambig — la status bar utilise
// désormais ▲ pour la phase executing-tool).
const SYM = {
  info: symbols.info,
  warn: symbols.warn,
  error: symbols.error,
  user: symbols.user,
  assistant: symbols.assistant,
  tool: symbols.tool,
  toolOut: symbols.toolOut,
  kicker: symbols.rule,
};

// Catégorise le tool par nom pour piloter la couleur de la puce ◆.
// Lecture (info/teal) / exécution (accent orange) / écriture (success vert).
// Les MCP préfixés `mcp__server__name` sont traités selon le suffix.
type ToolKind = "read" | "exec" | "write" | "default";
function toolKind(name: string): ToolKind {
  const n = name.replace(/^mcp__[^_]+__/, "").toLowerCase();
  if (
    n === "read" ||
    n === "glob" ||
    n === "ls" ||
    n === "grep" ||
    n === "list" ||
    n.startsWith("read") ||
    n.startsWith("get") ||
    n.startsWith("list") ||
    n.startsWith("search") ||
    n.startsWith("find")
  )
    return "read";
  if (n === "bash" || n === "shell" || n.includes("exec")) return "exec";
  if (
    n === "write" ||
    n === "edit" ||
    n === "multiedit" ||
    n.startsWith("write") ||
    n.startsWith("edit") ||
    n.startsWith("create") ||
    n.startsWith("delete") ||
    n.startsWith("update") ||
    n.startsWith("patch")
  )
    return "write";
  return "default";
}

function toolDotColor(name: string): (s: string) => string {
  // Avec la palette GLM (accent + success = vert vif), il faut disambiguer
  // Bash de Write/Edit qui sont tous verts. Bash → cyan info (action
  // distincte, lecture-écriture mélangée). Write/Edit → vert vif (mod
  // disque). Read → vert clair (lecture).
  switch (toolKind(name)) {
    case "read":
      return chalk.hex(c.accentSoft); // vert clair (lecture)
    case "exec":
      return chalk.hex("#67e8f9"); // cyan vif (exec shell, distinct du vert)
    case "write":
      return ATH.accent; // vert vif (modification disque)
    default:
      return ATH.accent;
  }
}

// Détection conhost legacy (Windows < 10) — bgHex y rend mal. Sur ces
// terminaux on skip le fond coloré et on garde juste le foreground.
const IS_LEGACY_CONSOLE =
  process.platform === "win32" && !process.env.WT_SESSION;

// Pad une ligne avec des espaces jusqu'à `cols` chars visibles, en
// retirant les codes ANSI pour le calcul de longueur. Utilisé pour
// produire un fond coloré plein-largeur (chalk.bgHex applique le bg
// uniquement sur les caractères de la string).
function padToWidth(line: string, cols: number): string {
  const visible = line.replace(/\x1b\[[0-9;]*m/g, "");
  const need = cols - visible.length;
  if (need <= 0) return line;
  return line + " ".repeat(need);
}

// Colorise une ligne de résultat de tool. Préfixes spéciaux :
// `+ ...`  → success + fond vert tinted (diff add)
// `- ...`  → danger + fond rouge tinted (diff del)
// `exit 0` → success
// `exit !=0` → danger
// `$ cmd`  → ink (commande shell pour Bash)
// sinon    → muted neutre.
//
// indentCols = nombre de chars du préfixe d'indentation (pour calcul
// padding bg full-width). Default 4 (= "    " indent du toolResultCompact).
function colorizeResultLine(line: string, indentCols = 4): string {
  // Diff lignes : fond coloré full-width (style GLM Coding Assistant).
  // Sur conhost legacy : skip bg, juste foreground.
  if (/^\s*\+ /.test(line)) {
    if (IS_LEGACY_CONSOLE) return ATH.success(line);
    const cols = (process.stdout.columns || 80) - indentCols;
    return chalk.bgHex(c.diffAdd).hex(c.success)(padToWidth(line, cols));
  }
  if (/^\s*- /.test(line)) {
    if (IS_LEGACY_CONSOLE) return ATH.danger(line);
    const cols = (process.stdout.columns || 80) - indentCols;
    return chalk.bgHex(c.diffDel).hex(c.danger)(padToWidth(line, cols));
  }
  if (/^exit 0\b/.test(line)) return ATH.success(line);
  if (/^exit \S+/.test(line)) return ATH.danger(line);
  if (/^\$ /.test(line)) return ATH.ink(line);
  return ATH.inkMuted(line);
}

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
  info: (msg: string) => ui(ATH.accent(SYM.info + "  ") + ATH.ink(msg), "info"),
  warn: (msg: string) =>
    ui(ATH.accentSoft(SYM.warn + "  ") + ATH.ink(msg), "warn"),
  error: (msg: string) =>
    ui(ATH.danger(SYM.error + "  ") + ATH.ink(msg), "error"),
  dim: (msg: string) => ui(ATH.inkMuted(msg)),
  faint: (msg: string) => ui(ATH.inkFaint(msg)),
  success: (msg: string) =>
    ui(ATH.success(SYM.info + "  ") + ATH.ink(msg), "info"),
  user: (msg: string) => ui(ATH.accent.bold(SYM.user + " ") + ATH.ink(msg)),
  assistant: (msg: string) =>
    ui(
      ATH.accent(SYM.assistant + " ") +
        ATH.ink(msg.replace(/\n/g, "\n  ")),
    ),
  // Format tool style Claude Code : puce colorée selon catégorie + nom
  // ink.bold + args en parenthèses dim. La puce indique la nature de
  // l'action :
  //   Read/Glob/Ls           → info teal (lecture/exploration)
  //   Grep                   → info teal (recherche)
  //   Bash                   → accent orange (exécution shell)
  //   Write/Edit/MultiEdit   → success vert (modification disque)
  //   autre/inconnu          → success vert par défaut
  // Permet de disambiguer visuellement "il a juste lu" vs "il vient
  // d'écrire sur disque" sans avoir à parser le name.
  tool: (name: string, detail: string) => {
    const dot = toolDotColor(name);
    ui(
      dot(SYM.tool + " ") +
        ATH.ink.bold(name) +
        (detail ? " " + ATH.inkMuted(detail) : ""),
    );
  },
  toolCompact: (name: string, label: string) => {
    const dot = toolDotColor(name);
    ui(
      dot(SYM.tool + " ") +
        ATH.ink.bold(name) +
        (label
          ? ATH.inkFaint("(") + ATH.inkMuted(label) + ATH.inkFaint(")")
          : ""),
    );
  },
  // Confirmation success après une action Edit/Write/MultiEdit. Affiche
  // `✓ Applied fix to <path>` en vert clair. Style GLM Coding Assistant.
  // Pas appelé pour Read/Bash/Grep — la ligne ⎿ result suffit pour eux.
  applied: (action: string, path: string) => {
    ui(
      ATH.success(symbols.success + " ") +
        ATH.success(action + " ") +
        ATH.ink(path),
    );
  },
  // Pousse une ligne du bloc Thinking. kind='read' = action mécanique
  // (couleur dim), 'find' = découverte (accent), 'done' = résolution
  // (success). header=true uniquement sur la 1re ligne d'un cluster
  // → affiche un kicker `Thinking…` au-dessus (cf. HistoryView).
  // Note : on push directement dans le store comme un type:'thinking'
  // (le rendu visuel se fait React-side, pas via chalk pré-rendu — pour
  // pouvoir composer le préfixe │ sur 2 colonnes).
  thinking: (
    kind: "read" | "find" | "done",
    text: string,
    header = false,
  ) => {
    historyStore.push({ type: "thinking", kind, text, header });
  },
  toolResultCompact: (summary: string, isError = false) => {
    // Indent 2 espaces + ⎿. Multi-lignes supporté : un \n dans summary
    // produit plusieurs lignes — la 1re préfixée par ⎿, les suivantes
    // par 4 espaces (continuations style Claude Code, ex: diff inline
    // d'un Edit ou stdout court d'un Bash).
    const arrow = "  " + (symbols.toolReturn || "⎿") + " ";
    const indent = "    ";
    const lines = summary.split("\n");
    lines.forEach((line, i) => {
      const prefix = i === 0 ? arrow : indent;
      if (isError) ui(ATH.danger(prefix) + ATH.danger(line), "error");
      else ui(ATH.inkFaint(prefix) + colorizeResultLine(line));
    });
  },
  toolResult: (text: string) => {
    const trimmed = text.length > 400 ? text.slice(0, 400) + "…" : text;
    const lines = trimmed.split("\n");
    for (const line of lines) {
      ui(ATH.inkFaint(SYM.toolOut + " ") + ATH.inkMuted(line));
    }
  },
  // Boot court style GLM Coding Assistant : 2 lignes plates, pas de
  // bande verticale ni de rule. L'info essentielle (model, mode) tient
  // sur la 2e ligne. Le banner riche reste accessible via /about.
  // Format :
  //   AI_CLI initialized.
  //   Connected to <baseUrl> · model <id> · mode <mode>
  //
  //   Type /about for details · /help for commands
  boot: (
    title: string,
    info: { baseUrl?: string; model?: string; mode?: string },
  ) => {
    ui("");
    ui(ATH.ink.bold(title) + ATH.inkDim(" initialized."));
    const parts: string[] = [];
    if (info.baseUrl)
      parts.push(ATH.inkMuted("Connected to ") + ATH.ink(info.baseUrl));
    if (info.model)
      parts.push(ATH.inkMuted("model ") + ATH.accent(info.model));
    if (info.mode) parts.push(ATH.inkMuted("mode ") + ATH.ink(info.mode));
    if (parts.length > 0)
      ui(parts.join(ATH.inkDim(" · ")));
    ui("");
    ui(
      ATH.inkDim("Type ") +
        ATH.accent("/about") +
        ATH.inkDim(" for details · ") +
        ATH.accent("/help") +
        ATH.inkDim(" for commands"),
    );
  },
  // Banner riche : bande accent verticale + nom + version + tagline.
  // Utilisé par /about, /help, /usage, /tools — gardé pour rétrocompat.
  banner: (title: string, version?: string, tagline?: string) => {
    const cols = Math.min(process.stdout.columns || 80, 100);
    const bar = ATH.accent("┃");
    const titleLine =
      bar +
      "  " +
      ATH.ink.bold(title) +
      (version
        ? "  " + ATH.inkFaint("·") + "  " + ATH.inkFaint("v" + version)
        : "");
    const taglineLine = tagline
      ? bar + "  " + ATH.inkFaint.italic(tagline)
      : null;
    ui("");
    ui(titleLine);
    if (taglineLine) ui(taglineLine);
    ui(ATH.inkFaint("─".repeat(Math.min(40, cols - 4))));
  },
  // Bloc specs aligné : chaque item = { icon, label, value, status }.
  // status colore le dot/icône (success vert, warn orange, error rouge).
  specs: (
    items: Array<{
      label: string;
      value: string;
      status?: "ok" | "warn" | "error" | "muted";
    }>,
  ) => {
    const labelWidth = Math.max(...items.map((i) => i.label.length)) + 2;
    for (const item of items) {
      const dot =
        item.status === "warn"
          ? ATH.accent("●")
          : item.status === "error"
            ? ATH.danger("●")
            : item.status === "muted"
              ? ATH.inkFaint("○")
              : ATH.success("●");
      const label = ATH.inkFaint(item.label.padEnd(labelWidth));
      ui("  " + dot + "  " + label + ATH.ink(item.value));
    }
  },
  status: (line: string) => {
    if (!line) return;
    const width = Math.min(process.stdout.columns || 80, 100);
    ui("");
    ui(ATH.inkFaint("─".repeat(width)));
    ui("  " + line);
    ui(ATH.inkFaint("─".repeat(width)));
  },
  rule: () => ui(ATH.inkFaint("─".repeat(40))),
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
