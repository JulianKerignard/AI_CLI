import React, { useEffect, useState } from "react";
import { Box, Static, Text } from "ink";
import { historyStore, type HistoryItem } from "./history-store.js";
import { c, symbols } from "./theme.js";
import { renderInlineMarkdown } from "./markdown-inline.js";
import { splitAssistantText, CodeBlock } from "./highlight.js";

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
      // Style app shell : pilule `YOU` sur fond accent (texte noir bold)
      // suivie du message. Une 2e ligne en faint affiche le contexte
      // (project · branch) sous la pilule. Pas de divider — la pilule
      // marque le début du tour suffisamment fort visuellement.
      const ctx: string[] = [];
      if (item.project) ctx.push(item.project);
      if (item.branch) ctx.push(`git:(${item.branch})`);
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row">
            <Text backgroundColor={c.accent} color="#0a0a0a" bold>
              {" YOU "}
            </Text>
            <Text>  {item.text}</Text>
          </Box>
          {ctx.length > 0 && (
            <Text color={c.inkFaint}>
              {"       "}
              {ctx.join(" · ")}
            </Text>
          )}
        </Box>
      );
    }
    case "assistant": {
      // Split le texte en segments alternés text / code block. Le
      // markdown inline (bold/italic/code) s'applique aux segments
      // text, le syntax highlighting aux segments code (CodeBlock).
      // Streaming-safe : un fence ```lang sans fermeture reste un
      // segment text → rendu en texte brut tant que le ``` fermant
      // n'arrive pas (re-coloration au push final).
      const segments = splitAssistantText(item.text);
      return (
        <Box flexDirection="column">
          {segments.map((seg, i) =>
            seg.kind === "code" ? (
              <CodeBlock key={i} code={seg.content} lang={seg.lang ?? ""} />
            ) : (
              <Text key={i}>{renderInlineMarkdown(seg.content)}</Text>
            ),
          )}
        </Box>
      );
    }
    case "tool":
    case "raw":
      return <Text>{item.text}</Text>;
    case "thinking": {
      // Bloc Thinking light : préfixe vertical │ faint à gauche pour
      // donner l'effet de bordure-bloc, glyphe + couleur selon kind.
      // header=true affiche un kicker `Thinking…` au-dessus (italique
      // info gris-bleu) — pour la 1re ligne d'un cluster d'investigation.
      const glyph =
        item.kind === "find"
          ? symbols.warn
          : item.kind === "done"
            ? symbols.success
            : symbols.prompt; // `>` pour read
      const fg =
        item.kind === "find"
          ? c.accentSoft
          : item.kind === "done"
            ? c.success
            : c.inkDim;
      return (
        <Box flexDirection="column">
          {item.header && (
            <Text color={c.info} italic>
              Thinking…
            </Text>
          )}
          <Text>
            <Text color={c.inkFaint}>{symbols.toolOut} </Text>
            <Text color={fg}>{glyph} </Text>
            <Text color={fg}>{item.text}</Text>
          </Text>
        </Box>
      );
    }
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
