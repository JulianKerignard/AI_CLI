import React from "react";
import { Box, Text } from "ink";
import { c } from "./theme.js";

// Syntax highlighting minimal pour code blocks ```lang ... ``` dans la
// réponse assistant. Regex maison, pas de dépendance externe (cli-highlight
// pèserait +400 KB pour 90% d'overkill). Couvre les langages les plus
// courants des sorties LLM : ts, js, tsx, jsx, py, sh/bash, json, md.
//
// Catégories de tokens et couleurs (mappées sur theme.ts) :
//   keyword  → c.info (gris-bleu froid)
//   string   → c.accentSoft (vert clair)
//   comment  → c.inkDim (gris discret)
//   number   → c.accentSoft
//   fn       → c.accent (vert vif — appel ou définition de fonction)
//   default  → c.ink (texte normal)
//
// Stratégie : tokenizer single-pass avec une regex unique alternant les
// catégories par priorité. Comment et string en premier (leur contenu
// ne doit PAS être reparsé comme keyword). Suffisant pour 95% des
// snippets LLM — on tolère les edge cases marginaux.

type Lang = "ts" | "js" | "py" | "sh" | "json" | "md" | "default";

interface Token {
  kind: "keyword" | "string" | "comment" | "number" | "fn" | "default";
  text: string;
}

// Listes de keywords par langage. Petites listes ciblées (les plus
// utilisées) — pas exhaustives.
const KW_TS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for",
  "while", "do", "switch", "case", "break", "continue", "default",
  "throw", "try", "catch", "finally", "new", "delete", "typeof",
  "instanceof", "in", "of", "import", "export", "from", "as", "async",
  "await", "yield", "class", "extends", "implements", "interface",
  "type", "enum", "namespace", "this", "super", "true", "false", "null",
  "undefined", "void", "any", "unknown", "never", "boolean", "number",
  "string", "object", "public", "private", "protected", "readonly",
  "static", "abstract", "declare", "module", "require",
]);

const KW_PY = new Set([
  "def", "class", "if", "elif", "else", "for", "while", "return",
  "yield", "import", "from", "as", "try", "except", "finally", "raise",
  "with", "lambda", "pass", "break", "continue", "global", "nonlocal",
  "and", "or", "not", "is", "in", "True", "False", "None", "self",
  "async", "await",
]);

const KW_SH = new Set([
  "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
  "case", "esac", "function", "return", "in", "echo", "printf",
  "export", "local", "readonly", "set", "unset", "shift", "test",
  "true", "false",
]);

const KW_JSON = new Set(["true", "false", "null"]);

function keywordsFor(lang: Lang): Set<string> {
  switch (lang) {
    case "ts":
    case "js":
      return KW_TS;
    case "py":
      return KW_PY;
    case "sh":
      return KW_SH;
    case "json":
      return KW_JSON;
    default:
      return new Set();
  }
}

function commentPattern(lang: Lang): RegExp | null {
  switch (lang) {
    case "ts":
    case "js":
      return /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
    case "py":
      return /#[^\n]*/g;
    case "sh":
      return /#[^\n]*/g;
    default:
      return null;
  }
}

// Regex strings + numbers — communs à tous les langages.
const RE_STRING = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;
const RE_NUMBER = /\b\d+\.?\d*\b/g;
const RE_IDENT = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
const RE_FN_CALL = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

// Normalise les noms de langages pris du fence ```lang ... ```.
export function normalizeLang(raw: string): Lang {
  const l = raw.toLowerCase().trim();
  if (l === "ts" || l === "typescript" || l === "tsx") return "ts";
  if (l === "js" || l === "javascript" || l === "jsx" || l === "node") return "js";
  if (l === "py" || l === "python" || l === "py3") return "py";
  if (l === "sh" || l === "bash" || l === "zsh" || l === "shell") return "sh";
  if (l === "json") return "json";
  if (l === "md" || l === "markdown") return "md";
  return "default";
}

// Tokenizer single-pass : on collecte les ranges de chaque catégorie via
// regex globales, on merge par position, on splitte le texte en tokens.
export function tokenize(code: string, lang: Lang): Token[] {
  if (lang === "default" || lang === "md") {
    return [{ kind: "default", text: code }];
  }

  const ranges: Array<{ start: number; end: number; kind: Token["kind"] }> = [];
  const seen = new Set<string>();

  const add = (start: number, end: number, kind: Token["kind"]) => {
    const key = `${start}-${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    ranges.push({ start, end, kind });
  };

  // 1. Comments — priorité max (leur contenu ne doit PAS être reparsé).
  const cre = commentPattern(lang);
  if (cre) {
    let m: RegExpExecArray | null;
    cre.lastIndex = 0;
    while ((m = cre.exec(code)) !== null) {
      add(m.index, m.index + m[0].length, "comment");
    }
  }

  // 2. Strings — après comments. Skip si dans un range comment déjà.
  RE_STRING.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_STRING.exec(code)) !== null) {
    if (!isInsideRange(m.index, ranges)) {
      add(m.index, m.index + m[0].length, "string");
    }
  }

  // 3. Function calls foo(... — utile pour ts/js/py.
  if (lang === "ts" || lang === "js" || lang === "py") {
    RE_FN_CALL.lastIndex = 0;
    while ((m = RE_FN_CALL.exec(code)) !== null) {
      const start = m.index;
      const end = start + m[1].length;
      if (!isInsideRange(start, ranges)) {
        add(start, end, "fn");
      }
    }
  }

  // 4. Numbers.
  RE_NUMBER.lastIndex = 0;
  while ((m = RE_NUMBER.exec(code)) !== null) {
    if (!isInsideRange(m.index, ranges)) {
      add(m.index, m.index + m[0].length, "number");
    }
  }

  // 5. Keywords — match d'identifiants entiers, comparé au set.
  const kws = keywordsFor(lang);
  if (kws.size > 0) {
    RE_IDENT.lastIndex = 0;
    while ((m = RE_IDENT.exec(code)) !== null) {
      if (kws.has(m[0]) && !isInsideRange(m.index, ranges)) {
        add(m.index, m.index + m[0].length, "keyword");
      }
    }
  }

  // 6. Trie + remplit les trous avec du "default".
  ranges.sort((a, b) => a.start - b.start);
  const tokens: Token[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue; // overlap déjà couvert (ne devrait pas arriver)
    if (r.start > cursor) {
      tokens.push({ kind: "default", text: code.slice(cursor, r.start) });
    }
    tokens.push({ kind: r.kind, text: code.slice(r.start, r.end) });
    cursor = r.end;
  }
  if (cursor < code.length) {
    tokens.push({ kind: "default", text: code.slice(cursor) });
  }
  return tokens;
}

function isInsideRange(
  pos: number,
  ranges: Array<{ start: number; end: number }>,
): boolean {
  for (const r of ranges) {
    if (pos >= r.start && pos < r.end) return true;
  }
  return false;
}

function colorFor(kind: Token["kind"]): string {
  switch (kind) {
    case "keyword":
      return c.info;
    case "string":
      return c.accentSoft;
    case "comment":
      return c.inkDim;
    case "number":
      return c.accentSoft;
    case "fn":
      return c.accent;
    default:
      return c.ink;
  }
}

// Composant React qui rend un code block colorisé. Box avec fond gris
// foncé (c.bgBlock) + padding latéral. Le contenu hérite de la couleur
// par token.
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const normalized = normalizeLang(lang);
  const tokens = tokenize(code, normalized);
  // Splitte par lignes pour préserver le wrap d'Ink. Chaque ligne devient
  // un Box avec fond gris + tokens colorisés en ligne.
  const lines = renderTokensAsLines(tokens);
  return (
    <Box flexDirection="column" marginY={1}>
      {lines.map((tokenLine, i) => (
        <Box key={i}>
          <Text color={c.inkFaint}>{" "}</Text>
          <Text backgroundColor={c.bgBlock}>
            {" "}
            {tokenLine.map((tok, j) => (
              <Text key={j} color={colorFor(tok.kind)} backgroundColor={c.bgBlock}>
                {tok.text}
              </Text>
            ))}
            {" "}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

// Re-splitte les tokens par \n pour avoir une List<List<Token>> ligne par
// ligne. Un token contenant un \n est splitté en plusieurs tokens de la
// même catégorie.
function renderTokensAsLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const tok of tokens) {
    const parts = tok.text.split("\n");
    parts.forEach((part, idx) => {
      if (part.length > 0) {
        lines[lines.length - 1].push({ kind: tok.kind, text: part });
      }
      if (idx < parts.length - 1) {
        lines.push([]);
      }
    });
  }
  // Trim trailing empty lines (souvent un `\n` final sur le code block).
  while (lines.length > 1 && lines[lines.length - 1].length === 0) {
    lines.pop();
  }
  return lines;
}

// Splitte un texte assistant en segments alternés "text" / "code block".
// Les fences ```lang ... ``` sont détectés. Si pas de fermeture (streaming
// en cours), le bloc reste ouvert et son contenu est rendu comme du texte
// brut (re-coloré quand le ``` fermant arrive).
export interface AssistantSegment {
  kind: "text" | "code";
  content: string;
  lang?: string;
}

const RE_FENCE = /```([a-zA-Z0-9+\-_]*)\n([\s\S]*?)```/g;

export function splitAssistantText(text: string): AssistantSegment[] {
  const segments: AssistantSegment[] = [];
  let lastIndex = 0;
  RE_FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_FENCE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ kind: "text", content: text.slice(lastIndex, m.index) });
    }
    segments.push({ kind: "code", content: m[2], lang: m[1] || "default" });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", content: text.slice(lastIndex) });
  }
  return segments;
}
