import React, { useEffect, useState } from "react";
import { Box, Static, Text } from "ink";
import { historyStore, type HistoryItem } from "./history-store.js";
import { c, symbols } from "./theme.js";

// Affiche les items FIGÉS via <Static> : chaque item rendu une seule
// fois quand ajouté, puis laissé scroller par le terminal. Pattern
// indispensable pour un CLI longue durée.
//
// L'item streaming (assistant en cours) n'est PAS dans Static — il est
// rendu séparément par App dans la zone dynamique pour que le texte
// grossisse live.

function formatItem(item: HistoryItem): React.ReactNode {
  switch (item.type) {
    case "user": {
      // Style oh-my-zsh agnoster light : `→ project git:(branch) message`.
      // Si pas de git/cwd : juste `→ message`.
      const hasCtx = Boolean(item.project || item.branch);
      return (
        <Text>
          <Text color={c.accent} bold>
            {symbols.arrowRight}{" "}
          </Text>
          {item.project && (
            <Text color={c.accentSoft}>{item.project} </Text>
          )}
          {item.branch && (
            <Text color={c.info}>git:({item.branch}) </Text>
          )}
          <Text color={hasCtx ? c.ink : c.inkMuted} bold={hasCtx}>
            {item.text}
          </Text>
        </Text>
      );
    }
    case "assistant":
      return <Text>{item.text}</Text>;
    case "tool":
    case "raw":
      return <Text>{item.text}</Text>;
    case "info":
      return (
        <Text>
          <Text color={c.info}>{symbols.info} </Text>
          {item.text}
        </Text>
      );
    case "warn":
      return <Text color={c.accentSoft}>{symbols.warn} {item.text}</Text>;
    case "error":
      return <Text color={c.danger}>{symbols.error} {item.text}</Text>;
  }
}

export function HistoryView() {
  const [items, setItems] = useState<readonly HistoryItem[]>(() =>
    historyStore.getItems(),
  );

  useEffect(() => {
    const update = () => setItems([...historyStore.getItems()]);
    // S'abonner uniquement à items-change (pas streaming-change) pour ne
    // PAS re-render la liste figée à chaque delta de stream.
    historyStore.on("items-change", update);
    return () => {
      historyStore.off("items-change", update);
    };
  }, []);

  return (
    <Static items={items as HistoryItem[]}>
      {(item) => (
        <Box key={item.id} paddingLeft={0}>
          {formatItem(item)}
        </Box>
      )}
    </Static>
  );
}

// Zone dynamique affichant l'assistant streamant (si en cours). Re-rend
// à chaque delta pour voir le texte grossir.
//
// ⚠ historyStore.getStreaming() retourne la MÊME référence d'objet tant que
// le stream est en cours (on mute .text). Un setStreaming(sameRef) ne
// déclenche PAS le re-render dans React (Object.is bail). On snapshot une
// copie à chaque change pour forcer la nouvelle référence.
export function StreamingView() {
  const snapshot = (): HistoryItem | null => {
    const cur = historyStore.getStreaming();
    return cur ? { ...cur } : null;
  };
  const [streaming, setStreaming] = useState<HistoryItem | null>(() =>
    snapshot(),
  );

  useEffect(() => {
    const update = () => setStreaming(snapshot());
    // Uniquement streaming-change : pas besoin de re-render sur items-change.
    historyStore.on("streaming-change", update);
    return () => {
      historyStore.off("streaming-change", update);
    };
  }, []);

  if (!streaming) return null;
  return <Box>{formatItem(streaming)}</Box>;
}
