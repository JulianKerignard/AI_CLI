import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PromptDecision } from "../permissions/prompt.js";

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

function categoryColor(c: Props["category"]): string {
  return c === "execute" ? "#c76a5f" : c === "edit" ? "#ec9470" : "#bdb3a1";
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
    const c = inp.toLowerCase();
    if (c === "y" || c === "o") onChoose("allow");
    else if (c === "a") onChoose("allow-session");
    else if (c === "p") onChoose("allow-persist");
    else if (c === "n") onChoose("deny");
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
      borderColor="#e27649"
      paddingX={1}
    >
      <Box>
        <Text color="#e27649">⚠ </Text>
        <Text color="#f6f1e8" bold>
          Permission requise
        </Text>
        <Text color="#8a8270"> · </Text>
        <Text color={categoryColor(category)}>{category}</Text>
        <Text color="#8a8270"> · </Text>
        <Text color="#ec9470" bold>
          {toolName}
        </Text>
      </Box>
      {inputLines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {inputLines.map(({ k, v }) => (
            <Box key={k}>
              <Text color="#bdb3a1">{"  " + k + "  "}</Text>
              <Text color="#f6f1e8">{v}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {CHOICES.map((c, i) => (
          <Box key={c.value}>
            <Text color={i === idx ? "#e27649" : "#4a4239"}>
              {i === idx ? "›" : " "}
            </Text>
            <Text color={i === idx ? "#f6f1e8" : "#bdb3a1"}>
              {" " + c.label.padEnd(22)}
            </Text>
            <Text color="#8a8270">{c.hint}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="#8a8270">
          ↑↓ · Enter valider · Esc refuser · raccourcis y / a / p / n
        </Text>
      </Box>
    </Box>
  );
}
