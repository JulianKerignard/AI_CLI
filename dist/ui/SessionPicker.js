import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { colors as c } from "./theme.js";
function formatRelative(ts) {
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24)
        return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}j`;
}
function formatDate(ts) {
    return new Date(ts).toLocaleString("fr-FR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}
export function SessionPicker({ items, onChoose }) {
    const [query, setQuery] = useState("");
    const [idx, setIdx] = useState(0);
    const pageSize = 10;
    const filtered = useMemo(() => {
        const q = query.toLowerCase();
        if (!q)
            return items;
        return items.filter((s) => s.title.toLowerCase().includes(q));
    }, [items, query]);
    useEffect(() => {
        if (idx >= filtered.length)
            setIdx(0);
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
        if (key.ctrl || key.meta)
            return;
        if (input && input.length > 0) {
            setQuery((q) => q + input);
        }
    });
    const start = Math.max(0, Math.min(idx - Math.floor(pageSize / 2), filtered.length - pageSize));
    const visible = filtered.slice(start, start + pageSize);
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: c.accent, paddingX: 1, children: [_jsxs(Box, { children: [_jsx(Text, { color: c.ink, bold: true, children: "Reprendre une session" }), _jsx(Text, { color: c.inkDim, children: ` (${filtered.length}/${items.length})` })] }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: c.inkMuted, children: "filter " }), _jsx(Text, { color: c.inkDim, children: "\u203A " }), _jsx(Text, { children: query }), _jsx(Text, { inverse: true, children: " " })] }), _jsxs(Box, { flexDirection: "column", marginTop: 1, children: [filtered.length === 0 && (_jsx(Text, { color: c.inkDim, children: items.length === 0
                            ? "aucune session pour ce dossier — lance juste une conversation"
                            : `aucun match pour "${query}"` })), visible.map((s, i) => {
                        const realIdx = start + i;
                        const active = realIdx === idx;
                        return (_jsxs(Box, { children: [_jsx(Text, { color: active ? c.accent : c.inkFaint, children: active ? "›" : " " }), _jsxs(Text, { color: active ? c.ink : c.inkMuted, children: [" ", s.title.padEnd(50).slice(0, 50)] }), _jsxs(Text, { color: c.inkDim, children: ["  ", formatDate(s.startedAt), " (il y a ", formatRelative(s.startedAt), ")"] }), _jsxs(Text, { color: c.success, children: ["  ", s.messageCount, " msg"] })] }, s.id));
                    })] }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: c.inkDim, children: "tape pour filtrer \u00B7 \u2191\u2193 naviguer \u00B7 Enter reprendre \u00B7 Esc annuler" }) })] }));
}
