import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { renderStatusLines, subscribeStatus } from "../utils/status-bar.js";

// Affiche le status block (4 lignes : rule + info + stats + phase) en bas
// de l'App Ink. S'abonne au store status-bar pour re-render sur change.
export function StatusLine({ columns }: { columns: number }) {
  const [lines, setLines] = useState<string[]>(() =>
    renderStatusLines(Math.min(columns, 140)),
  );

  useEffect(() => {
    const update = () => {
      setLines(renderStatusLines(Math.min(columns, 140)));
    };
    const unsub = subscribeStatus(update);
    return unsub;
  }, [columns]);

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
