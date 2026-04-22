import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Box, Static, Text } from "ink";
import { historyStore } from "./history-store.js";
// Affiche les items FIGÉS via <Static> : chaque item rendu une seule
// fois quand ajouté, puis laissé scroller par le terminal. Pattern
// indispensable pour un CLI longue durée.
//
// L'item streaming (assistant en cours) n'est PAS dans Static — il est
// rendu séparément par App dans la zone dynamique pour que le texte
// grossisse live.
function formatItem(item) {
    switch (item.type) {
        case "user":
            return (_jsxs(Text, { children: [_jsxs(Text, { color: "#e27649", bold: true, children: ["\u00BB", " "] }), _jsx(Text, { color: "#bdb3a1", children: item.text })] }));
        case "assistant":
            return _jsx(Text, { children: item.text });
        case "tool":
        case "raw":
            return _jsx(Text, { children: item.text });
        case "info":
            return (_jsxs(Text, { children: [_jsx(Text, { color: "#7fa8a6", children: "\u2139 " }), item.text] }));
        case "warn":
            return _jsxs(Text, { color: "#ec9470", children: ["\u26A0 ", item.text] });
        case "error":
            return _jsxs(Text, { color: "#c76a5f", children: ["\u2717 ", item.text] });
    }
}
export function HistoryView() {
    const [items, setItems] = useState(() => historyStore.getItems());
    useEffect(() => {
        const update = () => setItems([...historyStore.getItems()]);
        historyStore.on("change", update);
        return () => {
            historyStore.off("change", update);
        };
    }, []);
    return (_jsx(Static, { items: items, children: (item) => (_jsx(Box, { paddingLeft: 0, children: formatItem(item) }, item.id)) }));
}
// Zone dynamique affichant l'assistant streamant (si en cours). Re-rend
// à chaque delta pour voir le texte grossir.
export function StreamingView() {
    const [streaming, setStreaming] = useState(() => historyStore.getStreaming());
    useEffect(() => {
        const update = () => setStreaming(historyStore.getStreaming());
        historyStore.on("change", update);
        return () => {
            historyStore.off("change", update);
        };
    }, []);
    if (!streaming)
        return null;
    return _jsx(Box, { children: formatItem(streaming) });
}
