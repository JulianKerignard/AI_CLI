import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { c, symbols } from "./theme.js";

// Composant qui affiche une question posée par l'agent (tool AskUser).
// - Si options fourni : picker navigation ↑↓ + Enter.
// - Sinon : input text libre + Enter pour valider.
// Esc dans les deux cas annule (retourne null au tool → tool_result "aucune
// réponse, continue sans cette info").

interface Props {
  question: string;
  options?: string[];
  onAnswer: (answer: string | null) => void;
}

export function AskPicker({ question, options, onAnswer }: Props) {
  const hasOptions = Array.isArray(options) && options.length > 0;
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      onAnswer(null);
      return;
    }
    if (key.return) {
      if (hasOptions) {
        onAnswer(options![idx] ?? null);
      } else {
        onAnswer(typed.trim() || null);
      }
      return;
    }
    if (hasOptions) {
      if (key.upArrow) {
        setIdx((i) => (i - 1 + options!.length) % options!.length);
      } else if (key.downArrow) {
        setIdx((i) => (i + 1) % options!.length);
      }
      return;
    }
    // Mode texte libre.
    if (key.backspace || key.delete) {
      setTyped((t) => t.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta) return;
    if (input && input.length > 0) {
      setTyped((t) => t + input);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={c.accent}
      paddingX={1}
    >
      <Box>
        <Text color={c.accentSoft}>{symbols.tool} </Text>
        <Text color={c.ink}>{question}</Text>
      </Box>

      {hasOptions ? (
        <Box flexDirection="column" marginTop={1}>
          {options!.map((opt, i) => {
            const active = i === idx;
            return (
              <Box key={i}>
                <Text color={active ? c.accent : c.inkFaint}>
                  {active ? symbols.cursor : " "}
                </Text>
                <Text color={active ? c.ink : c.inkMuted}>
                  {" "}
                  {opt}
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={c.inkDim}>réponse {symbols.prompt} </Text>
          <Text>{typed}</Text>
          <Text inverse> </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={c.inkDim}>
          {hasOptions
            ? "↑↓ naviguer · Enter valider · Esc annuler"
            : "tape ta réponse · Enter valider · Esc annuler"}
        </Text>
      </Box>
    </Box>
  );
}
