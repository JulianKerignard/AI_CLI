import React from "react";
import { Text } from "ink";
import { c } from "./theme.js";

// Markdown inline minimal pour le texte assistant.
// Reconnu :
//   `code`         → bg gris + accentSoft (protégé en premier, son
//                    contenu n'est PAS reparsé comme markdown)
//   **bold**       → bold
//   *italic*       → italic (refuse `*` adjacent à un espace pour ne
//                    PAS matcher `2 * 3` ni `*` isolés)
//   _italic_       → italic (idem)
//
// Hors scope (étape E) : code blocks ``` ``` multi-ligne, headings,
// listes, links, tables, blockquotes. Le texte renvoyé conserve les
// retours à la ligne et les backticks triples — ils sont rendus tels
// quels jusqu'à ce que la syntax highlighting soit ajoutée.

type TokenKind = "text" | "code" | "bold" | "italic";
interface Token {
  kind: TokenKind;
  content: string;
}

// Regex global avec 4 groupes de capture (priorité dans cet ordre) :
// 1. inline code `...` (pas de \n interne, pas de backtick imbriqué)
// 2. bold **...** (au moins 1 char, pas de ** vide)
// 3. italic *...* — refuse espace adjacent au délimiteur
// 4. italic _..._ — refuse espace adjacent au délimiteur
//
// `\B` (non-word boundary) sur les `*` empêche de matcher au milieu
// d'un mot type `2*3*4` (où `*` est entre 2 chiffres = word context).
const RE =
  /(`[^`\n]+`)|(\*\*[^\s*][^*\n]*?\*\*|\*\*[^*\n]+?\*\*)|(\*[^\s*][^*\n]*?[^\s*]\*|\*[^\s*]\*)|(_[^\s_][^_\n]*?[^\s_]_|_[^\s_]_)/g;

export function tokenizeInline(text: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  // RE est `g` — on doit le ré-instancier ou reset .lastIndex à chaque
  // appel pour éviter qu'un appel précédent laisse un offset bancal.
  RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ kind: "text", content: text.slice(lastIndex, m.index) });
    }
    if (m[1]) {
      tokens.push({ kind: "code", content: m[1].slice(1, -1) });
    } else if (m[2]) {
      tokens.push({ kind: "bold", content: m[2].slice(2, -2) });
    } else if (m[3]) {
      tokens.push({ kind: "italic", content: m[3].slice(1, -1) });
    } else if (m[4]) {
      tokens.push({ kind: "italic", content: m[4].slice(1, -1) });
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: "text", content: text.slice(lastIndex) });
  }
  return tokens;
}

// Rend les tokens en éléments React. Plat (pas de markdown imbriqué :
// **bold _italic_** → bold seul, pas italic-dans-bold). Suffisant pour
// 99% des sorties LLM.
export function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const tokens = tokenizeInline(text);
  // Si pas de markup détecté, retour direct (évite un Fragment inutile
  // qui peut perturber le wrap d'Ink).
  if (tokens.length === 1 && tokens[0].kind === "text") {
    return text;
  }
  return tokens.map((tok, i) => {
    switch (tok.kind) {
      case "text":
        return <Text key={i}>{tok.content}</Text>;
      case "code":
        return (
          <Text key={i} backgroundColor={c.bgBlock} color={c.accentSoft}>
            {" " + tok.content + " "}
          </Text>
        );
      case "bold":
        return (
          <Text key={i} bold>
            {tok.content}
          </Text>
        );
      case "italic":
        return (
          <Text key={i} italic>
            {tok.content}
          </Text>
        );
    }
  });
}
