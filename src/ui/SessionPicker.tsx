import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionSummary } from "../sessions/store.js";
import { colors as c } from "./theme.js";

// Picker natif Ink pour /resume — liste les sessions du cwd courant
// avec filter texte (tape pour filtrer sur le title), timestamp et
// nombre de messages.

interface Props {
  items: SessionSummary[];
  onChoose: (path: string | null) => void;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}j`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("fr-FR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionPicker({ items, onChoose }: Props) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const pageSize = 10;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return items;
    return items.filter((s) => s.title.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (idx >= filtered.length) setIdx(0);
  }, [filtered.length, idx]);

  useInput((input, key) => {
    if (key.escape) {
      onChoose(null);
      return;
    }
    if (key.return) {
      onChoose(filtered[idx]?.path ?? null);
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

  const start = Math.max(
    0,
    Math.min(idx - Math.floor(pageSize / 2), filtered.length - pageSize),
  );
  const visible = filtered.slice(start, start + pageSize);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={c.accent}
      paddingX={1}
    >
      <Box>
        <Text color={c.ink} bold>
          Reprendre une session
        </Text>
        <Text color={c.inkDim}>{` (${filtered.length}/${items.length})`}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={c.inkMuted}>filter </Text>
        <Text color={c.inkDim}>› </Text>
        <Text>{query}</Text>
        <Text inverse> </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {filtered.length === 0 && (
          <Text color={c.inkDim}>
            {items.length === 0
              ? "aucune session pour ce dossier — lance juste une conversation"
              : `aucun match pour "${query}"`}
          </Text>
        )}
        {visible.map((s, i) => {
          const realIdx = start + i;
          const active = realIdx === idx;
          return (
            <Box key={s.id}>
              <Text color={active ? c.accent : c.inkFaint}>
                {active ? "›" : " "}
              </Text>
              <Text color={active ? c.ink : c.inkMuted}>
                {" "}
                {s.title.padEnd(50).slice(0, 50)}
              </Text>
              <Text color={c.inkDim}>
                {"  "}
                {formatDate(s.startedAt)} (il y a {formatRelative(s.startedAt)})
              </Text>
              <Text color={c.success}>
                {"  "}
                {s.messageCount} msg
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={c.inkDim}>
          tape pour filtrer · ↑↓ naviguer · Enter reprendre · Esc annuler
        </Text>
      </Box>
    </Box>
  );
}
