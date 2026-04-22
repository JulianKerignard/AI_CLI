import React, { useState, useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";

// Picker natif Ink — remplace @inquirer/search qui créait un readline
// parallèle et laissait des artefacts visuels. Flèches ↑↓ pour naviguer,
// taper pour filtrer, Enter pour valider, Esc pour annuler.

export interface ModelItem {
  id: string;
  provider: string;
  category: string;
  description?: string;
  weight: number;
}

interface Props {
  items: ModelItem[];
  initial?: string;
  pageSize?: number;
  onChoose: (id: string | null) => void;
}

export function ModelPicker({ items, initial, pageSize = 10, onChoose }: Props) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(() => {
    const i = initial ? items.findIndex((m) => m.id === initial) : 0;
    return i >= 0 ? i : 0;
  });

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return items;
    return items.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    // Reset l'index sur changement de filtre pour qu'il reste dans les bornes.
    if (idx >= filtered.length) setIdx(0);
  }, [filtered.length, idx]);

  useInput((input, key) => {
    if (key.escape) {
      onChoose(null);
      return;
    }
    if (key.return) {
      const pick = filtered[idx];
      onChoose(pick?.id ?? null);
      return;
    }
    if (key.upArrow) {
      setIdx((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
      return;
    }
    if (key.downArrow) {
      setIdx((i) => (i + 1) % Math.max(1, filtered.length));
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta) return;
    if (input && input.length > 0) {
      setQuery((q) => q + input);
    }
  });

  // Fenêtre de pageSize items centrée sur idx.
  const start = Math.max(
    0,
    Math.min(idx - Math.floor(pageSize / 2), filtered.length - pageSize),
  );
  const visible = filtered.slice(start, start + pageSize);

  const providerColor = (p: string): string =>
    p === "nvidia" ? "#7fa670" : p === "persona" ? "#ec9470" : "#e27649";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#e27649"
      paddingX={1}
    >
      <Box>
        <Text color="#bdb3a1">model </Text>
        <Text color="#8a8270">› </Text>
        <Text>{query}</Text>
        <Text inverse> </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visible.length === 0 && (
          <Text color="#8a8270">aucun match pour "{query}"</Text>
        )}
        {visible.map((m, i) => {
          const realIdx = start + i;
          const active = realIdx === idx;
          return (
            <Box key={m.id}>
              <Text color={active ? "#e27649" : "#4a4239"}>
                {active ? "›" : " "}
              </Text>
              <Text color={active ? "#f6f1e8" : "#bdb3a1"}>
                {" "}
                {m.id.padEnd(55)}
              </Text>
              <Text color={providerColor(m.provider)}>{m.provider}</Text>
              <Text color="#8a8270">
                {"  "}
                {m.category}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="#8a8270">
          {filtered.length} match · ↑↓ naviguer · Enter valider · Esc annuler
        </Text>
      </Box>
    </Box>
  );
}
