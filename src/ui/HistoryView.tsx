import React, { useEffect, useState } from "react";
import { Box, Static, Text } from "ink";
import { historyStore, type HistoryItem } from "./history-store.js";

// Affiche les items FIGÉS via <Static> : chaque item rendu une seule
// fois quand ajouté, puis laissé scroller par le terminal. Pattern
// indispensable pour un CLI longue durée.
//
// L'item streaming (assistant en cours) n'est PAS dans Static — il est
// rendu séparément par App dans la zone dynamique pour que le texte
// grossisse live.

function formatItem(item: HistoryItem): React.ReactNode {
  switch (item.type) {
    case "user":
      return (
        <Text>
          <Text color="#e27649" bold>
            »{" "}
          </Text>
          <Text color="#bdb3a1">{item.text}</Text>
        </Text>
      );
    case "assistant":
      return <Text>{item.text}</Text>;
    case "tool":
    case "raw":
      return <Text>{item.text}</Text>;
    case "info":
      return (
        <Text>
          <Text color="#7fa8a6">ℹ </Text>
          {item.text}
        </Text>
      );
    case "warn":
      return <Text color="#ec9470">⚠ {item.text}</Text>;
    case "error":
      return <Text color="#c76a5f">✗ {item.text}</Text>;
  }
}

export function HistoryView() {
  const [items, setItems] = useState<readonly HistoryItem[]>(() =>
    historyStore.getItems(),
  );

  useEffect(() => {
    const update = () => setItems([...historyStore.getItems()]);
    historyStore.on("change", update);
    return () => {
      historyStore.off("change", update);
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
export function StreamingView() {
  const [streaming, setStreaming] = useState<HistoryItem | null>(() =>
    historyStore.getStreaming(),
  );

  useEffect(() => {
    const update = () => setStreaming(historyStore.getStreaming());
    historyStore.on("change", update);
    return () => {
      historyStore.off("change", update);
    };
  }, []);

  if (!streaming) return null;
  return <Box>{formatItem(streaming)}</Box>;
}
