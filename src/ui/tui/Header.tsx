import React from "react";
import { Box, Text } from "ink";
import { c, symbols } from "../theme.js";

// Header sticky du mode fullscreen. Ligne unique avec :
//   ◆ AICLI · model · mode · ↻ baseUrl
// Le diamant pulse à l'avenir (étape T7) selon l'état provider, pour
// l'instant statique. Tronque proprement si dépasse cols.

interface Props {
  appName: string;
  version: string;
  model: string;
  mode: string;
  baseUrl?: string;
  cols: number;
}

export function Header({ appName, version, model, mode, baseUrl, cols }: Props) {
  // Construction segments + estimation longueur pour ellipsis.
  const sep = `  ${symbols.midDot}  `;

  return (
    <Box width={cols} height={1} flexDirection="row" paddingX={1}>
      <Text color={c.accent} bold>
        {symbols.tool}{" "}
      </Text>
      <Text color={c.ink} bold>
        {appName}
      </Text>
      <Text color={c.inkFaint}>{sep}</Text>
      <Text color={c.inkMuted}>{model}</Text>
      <Text color={c.inkFaint}>{sep}</Text>
      <Text color={c.accentSoft}>{mode}</Text>
      {baseUrl && (
        <>
          <Text color={c.inkFaint}>{sep}</Text>
          <Text color={c.inkDim}>↻ {baseUrl}</Text>
        </>
      )}
      <Box flexGrow={1} />
      <Text color={c.inkFaint}>v{version}</Text>
    </Box>
  );
}
