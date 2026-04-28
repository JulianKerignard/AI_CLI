import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PromptDecision } from "../permissions/prompt.js";
import { c, symbols } from "./theme.js";

// Picker natif Ink pour askPermission (remplace @inquirer/select qui
// créait des artefacts visuels en cohabitant avec Ink). 4 choix
// classiques y/session/persist/deny + navigation ↑↓ + Enter valider.

const CHOICES: Array<{ value: PromptDecision; label: string; hint: string }> = [
  { value: "allow", label: "Yes", hint: "une fois" },
  { value: "allow-session", label: "Always this session", hint: "pour tout ce REPL" },
  { value: "allow-persist", label: "Persist always", hint: "enregistré" },
  { value: "deny", label: "No", hint: "refuser" },
];

interface Props {
  toolName: string;
  category: "safe" | "edit" | "execute";
  input: Record<string, unknown>;
  onChoose: (decision: PromptDecision) => void;
}

function categoryColor(cat: Props["category"]): string {
  return cat === "execute" ? c.danger : cat === "edit" ? c.accentSoft : c.inkMuted;
}

export function PermissionPicker({ toolName, category, input, onChoose }: Props) {
  const [idx, setIdx] = useState(0);

  useInput((inp, key) => {
    if (key.escape) {
      onChoose("deny");
      return;
    }
    if (key.return) {
      onChoose(CHOICES[idx].value);
      return;
    }
    if (key.upArrow) {
      setIdx((i) => (i - 1 + CHOICES.length) % CHOICES.length);
      return;
    }
    if (key.downArrow) {
      setIdx((i) => (i + 1) % CHOICES.length);
      return;
    }
    // Raccourcis clavier y/a/p/n/o
    if (!inp) return;
    const ch = inp.toLowerCase();
    if (ch === "y" || ch === "o") onChoose("allow");
    else if (ch === "a") onChoose("allow-session");
    else if (ch === "p") onChoose("allow-persist");
    else if (ch === "n") onChoose("deny");
  });

  const inputLines = Object.entries(input).slice(0, 4).map(([k, v]) => {
    const val =
      typeof v === "string"
        ? v.length > 120
          ? v.slice(0, 120) + "…"
          : v.replace(/\n/g, "⏎")
        : JSON.stringify(v).slice(0, 120);
    return { k, v: val };
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={c.accent}
      paddingX={1}
    >
      <Box>
        <Text color={c.accent}>{symbols.warn} </Text>
        <Text color={c.ink} bold>
          Permission requise
        </Text>
        <Text color={c.inkDim}> · </Text>
        <Text color={categoryColor(category)}>{category}</Text>
        <Text color={c.inkDim}> · </Text>
        <Text color={c.accentSoft} bold>
          {toolName}
        </Text>
      </Box>
      {inputLines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {inputLines.map(({ k, v }) => (
            <Box key={k}>
              <Text color={c.inkMuted}>{"  " + k + "  "}</Text>
              <Text color={c.ink}>{v}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {CHOICES.map((choice, i) => (
          <Box key={choice.value}>
            <Text color={i === idx ? c.accent : c.inkFaint}>
              {i === idx ? symbols.cursor : " "}
            </Text>
            <Text color={i === idx ? c.ink : c.inkMuted}>
              {" " + choice.label.padEnd(22)}
            </Text>
            <Text color={c.inkDim}>{choice.hint}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={c.inkDim}>
          ↑↓ · Enter valider · Esc refuser · raccourcis y / a / p / n
        </Text>
      </Box>
    </Box>
  );
}
