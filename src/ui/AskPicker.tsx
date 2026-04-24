import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

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
      borderColor="#e27649"
      paddingX={1}
    >
      <Box>
        <Text color="#ec9470">◆ </Text>
        <Text color="#f6f1e8">{question}</Text>
      </Box>

      {hasOptions ? (
        <Box flexDirection="column" marginTop={1}>
          {options!.map((opt, i) => {
            const active = i === idx;
            return (
              <Box key={i}>
                <Text color={active ? "#e27649" : "#4a4239"}>
                  {active ? "›" : " "}
                </Text>
                <Text color={active ? "#f6f1e8" : "#bdb3a1"}>
                  {" "}
                  {opt}
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color="#8a8270">réponse › </Text>
          <Text>{typed}</Text>
          <Text inverse> </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="#8a8270">
          {hasOptions
            ? "↑↓ naviguer · Enter valider · Esc annuler"
            : "tape ta réponse · Enter valider · Esc annuler"}
        </Text>
      </Box>
    </Box>
  );
}
