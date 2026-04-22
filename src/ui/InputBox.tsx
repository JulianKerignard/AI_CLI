import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";

// Saisie avec bordure (style Claude Code). Minimaliste — un input d'une
// ligne, cursor visible, Enter = submit, Ctrl-C = cancel (double = exit).
// Pas de wrap multi-ligne en V1 (le terminal natif tronque visuellement).

interface Props {
  disabled?: boolean;
  onSubmit: (input: string) => void;
  onInterrupt: () => void; // Ctrl-C : à double coup dans 1.5s = exit
  placeholder?: string;
}

export function InputBox({ disabled, onSubmit, onInterrupt, placeholder }: Props) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);

  const submit = useCallback(() => {
    const v = value;
    setValue("");
    setCursor(0);
    onSubmit(v);
  }, [value, onSubmit]);

  useInput(
    (input, key) => {
      if (disabled) return;
      if (key.return) {
        submit();
        return;
      }
      if (key.ctrl && input === "c") {
        onInterrupt();
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setValue(value.slice(0, cursor - 1) + value.slice(cursor));
          setCursor(cursor - 1);
        }
        return;
      }
      if (key.leftArrow) {
        setCursor(Math.max(0, cursor - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor(Math.min(value.length, cursor + 1));
        return;
      }
      if (key.meta || key.ctrl || key.escape) return;
      // Char normal (inclut espace, accents, etc.)
      if (input && input.length > 0 && !key.shift) {
        setValue(value.slice(0, cursor) + input + value.slice(cursor));
        setCursor(cursor + input.length);
      } else if (input) {
        // Shift+char : keep the char, ignore shift flag
        setValue(value.slice(0, cursor) + input + value.slice(cursor));
        setCursor(cursor + input.length);
      }
    },
    { isActive: !disabled },
  );

  // Rendu : split autour du cursor pour afficher le caret inversé.
  const before = value.slice(0, cursor);
  const atCursor = value.slice(cursor, cursor + 1) || " ";
  const after = value.slice(cursor + 1);
  const showPlaceholder = value.length === 0 && placeholder;

  return (
    <Box
      borderStyle="round"
      borderColor="#4a4239"
      paddingX={1}
      flexDirection="row"
    >
      <Text color="#e27649">›{" "}</Text>
      {showPlaceholder ? (
        <Text color="#4a4239">{placeholder}</Text>
      ) : (
        <Text>
          {before}
          <Text inverse>{atCursor}</Text>
          {after}
        </Text>
      )}
    </Box>
  );
}
