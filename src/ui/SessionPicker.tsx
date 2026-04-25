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
  // Mode "--all" : sessions de tous dossiers confondus → afficher le cwd
  // dans chaque ligne pour distinguer les projets. Sinon (mode défaut),
  // toutes les sessions sont du même cwd, pas la peine de l'afficher.
  showCwd?: boolean;
}

function shortenCwd(cwd: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  let s = cwd;
  if (home && s.startsWith(home)) s = "~" + s.slice(home.length);
  // Tronque le milieu si trop long : ~/projets/.../mon-app
  if (s.length > 35) {
    const parts = s.split("/");
    if (parts.length > 4) {
      return parts.slice(0, 2).join("/") + "/.../" + parts[parts.length - 1];
    }
  }
  return s;
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

export function SessionPicker({ items, onChoose, showCwd = false }: Props) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const pageSize = 10;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return items;
    return items.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (showCwd && s.cwd.toLowerCase().includes(q)),
    );
  }, [items, query, showCwd]);

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
          {showCwd ? "Reprendre une session (tous dossiers)" : "Reprendre une session"}
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
          // En mode --all, le titre est plus court pour laisser de la
          // place au cwd. Sinon le titre prend toute la largeur dispo.
          const titleWidth = showCwd ? 32 : 50;
          return (
            <Box key={s.id} flexDirection="column">
              <Box>
                <Text color={active ? c.accent : c.inkFaint}>
                  {active ? "›" : " "}
                </Text>
                <Text color={active ? c.ink : c.inkMuted}>
                  {" "}
                  {s.title.padEnd(titleWidth).slice(0, titleWidth)}
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
              {showCwd && (
                <Box marginLeft={2}>
                  <Text color={c.inkFaint}>
                    {shortenCwd(s.cwd)}
                  </Text>
                </Box>
              )}
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
