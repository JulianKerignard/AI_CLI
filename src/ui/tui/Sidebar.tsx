import React from "react";
import { Box, Text } from "ink";
import { c, symbols } from "../theme.js";

// Sidebar du mode fullscreen — placeholder PR#1. Le contenu réel
// (sessions / models / tools) arrive en T8. Pour l'instant juste les
// titres de section pour valider le layout.

interface Props {
  width: number;
  height: number;
}

export function Sidebar({ width, height }: Props) {
  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      paddingX={1}
      paddingY={0}
    >
      <Text color={c.inkDim} bold>
        SESSIONS
      </Text>
      <Text color={c.inkFaint}>{"  "}—</Text>
      <Box marginTop={1}>
        <Text color={c.inkDim} bold>
          MODELS
        </Text>
      </Box>
      <Text color={c.inkFaint}>{"  "}—</Text>
      <Box marginTop={1}>
        <Text color={c.inkDim} bold>
          TOOLS
        </Text>
      </Box>
      <Text color={c.inkFaint}>{"  "}—</Text>
      <Box flexGrow={1} />
      <Text color={c.inkFaint}>
        {symbols.midDot} {"^B".padEnd(width - 4)}
      </Text>
    </Box>
  );
}
