import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionSummary } from "../sessions/store.js";

// Picker natif Ink pour /resume — liste les sessions du cwd courant
// avec leur titre (1er user message), timestamp et nombre de messages.

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
  const [idx, setIdx] = useState(0);
  const pageSize = 10;

  useInput((_inp, key) => {
    if (key.escape) {
      onChoose(null);
      return;
    }
    if (key.return) {
      onChoose(items[idx]?.path ?? null);
      return;
    }
    if (key.upArrow) {
      setIdx((i) => (i - 1 + items.length) % Math.max(1, items.length));
      return;
    }
    if (key.downArrow) {
      setIdx((i) => (i + 1) % Math.max(1, items.length));
      return;
    }
  });

  const start = Math.max(
    0,
    Math.min(idx - Math.floor(pageSize / 2), items.length - pageSize),
  );
  const visible = items.slice(start, start + pageSize);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#e27649"
      paddingX={1}
    >
      <Box>
        <Text color="#f6f1e8" bold>
          Reprendre une session
        </Text>
        <Text color="#8a8270">{` (${items.length} dispo)`}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {items.length === 0 && (
          <Text color="#8a8270">
            aucune session pour ce dossier — lance juste une conversation
          </Text>
        )}
        {visible.map((s, i) => {
          const realIdx = start + i;
          const active = realIdx === idx;
          return (
            <Box key={s.id}>
              <Text color={active ? "#e27649" : "#4a4239"}>
                {active ? "›" : " "}
              </Text>
              <Text color={active ? "#f6f1e8" : "#bdb3a1"}>
                {" "}
                {s.title.padEnd(50).slice(0, 50)}
              </Text>
              <Text color="#8a8270">
                {"  "}
                {formatDate(s.startedAt)} (il y a {formatRelative(s.startedAt)})
              </Text>
              <Text color="#7fa670">
                {"  "}
                {s.messageCount} msg
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="#8a8270">↑↓ naviguer · Enter reprendre · Esc annuler</Text>
      </Box>
    </Box>
  );
}
