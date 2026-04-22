import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { renderStatusLines, subscribeStatus } from "../utils/status-bar.js";
// Affiche le status block (4 lignes : rule + info + stats + phase) en bas
// de l'App Ink. S'abonne au store status-bar pour re-render sur change.
export function StatusLine({ columns }) {
    const [lines, setLines] = useState(() => renderStatusLines(Math.min(columns, 140)));
    useEffect(() => {
        const update = () => {
            setLines(renderStatusLines(Math.min(columns, 140)));
        };
        const unsub = subscribeStatus(update);
        return unsub;
    }, [columns]);
    return (_jsx(Box, { flexDirection: "column", children: lines.map((line, i) => (_jsx(Text, { children: line }, i))) }));
}
