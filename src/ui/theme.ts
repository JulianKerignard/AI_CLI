// Palette + symboles centralisés. Avant : 88 hex hardcodés éparpillés
// dans 10 fichiers, et 3 symboles polysémiques (›=info+prompt+curseur+
// label+hint, ●=assistant+statusDot+phase, ◆=tool+providerTag+phase).
// Une seule source de vérité ici.

export const colors = {
  // Accents — palette GLM/terminal vert vif sur fond noir profond.
  // Avant : orange Athenaeum (#e27649) — gardé pour référence en commentaire.
  accent: "#4ade80", // vert vif (était #e27649)
  accentSoft: "#86efac", // vert clair (était #ec9470)
  accentDeep: "#16a34a", // vert foncé (était #b85a31)
  // Ink (text)
  ink: "#f6f1e8",
  inkBright: "#f6f1e8",
  inkMuted: "#bdb3a1",
  inkDim: "#8a8270",
  inkFaint: "#4a4239",
  // Semantic — success fusionne avec accent (vert), info bascule en gris-bleu
  // froid pour les blocs "Thinking…" (cohérent GLM).
  success: "#4ade80", // alias accent (était #7fa670)
  danger: "#f87171", // rouge tinted lisible (était #c76a5f)
  info: "#94a3b8", // gris-bleu froid pour reasoning (était #7fa8a6 teal)
  // Backgrounds tinted pour diff inline (rouge/vert ~25% saturation).
  diffAdd: "#14361d",
  diffDel: "#3f1d1d",
  // Structure
  border: "#4a4239",
  borderDim: "#2a2520",
  bgTag: "#245454",
  bgBlock: "#1a1a1a", // fond gris foncé pour blocs "Thinking..." / code
} as const;

// Alias court pour les composants Ink qui consomment souvent.
export const c = colors;

// Détection du conhost legacy (Windows < 10 / cmd.exe). WT_SESSION est
// set uniquement par Windows Terminal. Dupliqué ici (déjà présent dans
// status-bar.ts) pour éviter une dépendance status-bar → theme et garder
// theme.ts libre d'effets de bord.
const IS_LEGACY_CONSOLE =
  process.platform === "win32" && !process.env.WT_SESSION;

// Symboles disambigués. Chaque sens a son glyphe propre. Fallback ASCII
// pour conhost legacy (Unicode partiel) tient sur la même table — pas
// de branchement dispersé.
//
// Conventions :
// - cursor      = curseur de sélection actif dans un picker (▸)
// - prompt      = invite de saisie utilisateur (›) — mono-sens désormais
// - info        = bullet d'information logger (•) — séparé du prompt
// - user        = message utilisateur dans l'historique (»)
// - assistant   = message agent dans l'historique (●)
// - tool        = appel d'outil (◆)
// - toolOut     = continuation multi-ligne d'un tool result (│)
// - toolReturn  = puce de résultat indenté (⎿) — repris de Claude Code
// - phaseTool   = phase 'executing-tool' dans la status bar (▲)
//                 (évite la collision avec `tool` qui sert au logger)
// - warn / error / success / question = sémantiques classiques
interface SymbolTable {
  cursor: string;
  prompt: string;
  info: string;
  user: string;
  assistant: string;
  tool: string;
  toolOut: string;
  toolReturn: string;
  phaseTool: string;
  warn: string;
  error: string;
  success: string;
  question: string;
  bar: string;
  rule: string;
  ellipsis: string;
  midDot: string;
  arrowUp: string;
  arrowDown: string;
  arrowRight: string;
}

const SYMBOLS_UNICODE: SymbolTable = {
  cursor: "▸",
  prompt: "›",
  info: "•",
  user: "»",
  assistant: "●",
  tool: "◆",
  toolOut: "│",
  toolReturn: "⎿",
  phaseTool: "▲",
  warn: "⚠",
  error: "✗",
  success: "✓",
  question: "?",
  bar: "┃",
  rule: "─",
  ellipsis: "…",
  midDot: "·",
  arrowUp: "↑",
  arrowDown: "↓",
  arrowRight: "→",
};

const SYMBOLS_ASCII: SymbolTable = {
  cursor: ">",
  prompt: ">",
  info: "*",
  user: ">>",
  assistant: "*",
  tool: "#",
  toolOut: "|",
  toolReturn: "L>",
  phaseTool: "^",
  warn: "!",
  error: "x",
  success: "+",
  question: "?",
  bar: "|",
  rule: "-",
  ellipsis: "...",
  midDot: ".",
  arrowUp: "^",
  arrowDown: "v",
  arrowRight: "->",
};

export const symbols = IS_LEGACY_CONSOLE ? SYMBOLS_ASCII : SYMBOLS_UNICODE;

// Largeurs de colonnes pour les pickers (étape 6). Centralise les padEnd
// magiques (40/22/16/10/8/9). Auto-shrink possible : un picker peut
// passer une largeur réduite si cols<90.
export const pickerCols = {
  label: 36,
  badge: 10,
  meta: 8,
  hint: 14,
} as const;

// Tronque une string à `max` chars en ajoutant '…' si dépassement. Sans
// rapport avec l'unicode-width — pour des chars latins ça suffit.
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + symbols.ellipsis;
}
