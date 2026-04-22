import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";
export function ModelPicker({ items, initial, pageSize = 10, onChoose }) {
    const [query, setQuery] = useState("");
    const [idx, setIdx] = useState(() => {
        const i = initial ? items.findIndex((m) => m.id === initial) : 0;
        return i >= 0 ? i : 0;
    });
    const filtered = useMemo(() => {
        const q = query.toLowerCase();
        if (!q)
            return items;
        return items.filter((m) => m.id.toLowerCase().includes(q) ||
            m.category.toLowerCase().includes(q) ||
            m.provider.toLowerCase().includes(q));
    }, [items, query]);
    useEffect(() => {
        // Reset l'index sur changement de filtre pour qu'il reste dans les bornes.
        if (idx >= filtered.length)
            setIdx(0);
    }, [filtered.length, idx]);
    useInput((input, key) => {
        if (key.escape) {
            onChoose(null);
            return;
        }
        if (key.return) {
            const pick = filtered[idx];
            onChoose(pick?.id ?? null);
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
    // Fenêtre de pageSize items centrée sur idx.
    const start = Math.max(0, Math.min(idx - Math.floor(pageSize / 2), filtered.length - pageSize));
    const visible = filtered.slice(start, start + pageSize);
    const providerColor = (p) => p === "nvidia" ? "#7fa670" : p === "persona" ? "#ec9470" : "#e27649";
    // Extrait le suffixe "rapide"/"moyen"/"lent" depuis la description
    // server-side (format 'NVIDIA · owner · tier · speed'). Couleur :
    // rapide = vert, moyen = orange, lent = rouge.
    const speedBadge = (desc) => {
        if (!desc)
            return null;
        if (/\brapide\b/i.test(desc))
            return { label: "rapide", color: "#7fa670" };
        if (/\bmoyen\b/i.test(desc))
            return { label: "moyen", color: "#ec9470" };
        if (/\blent\b/i.test(desc))
            return { label: "lent", color: "#c76a5f" };
        return null;
    };
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: "#e27649", paddingX: 1, children: [_jsxs(Box, { children: [_jsx(Text, { color: "#bdb3a1", children: "model " }), _jsx(Text, { color: "#8a8270", children: "\u203A " }), _jsx(Text, { children: query }), _jsx(Text, { inverse: true, children: " " })] }), _jsxs(Box, { flexDirection: "column", marginTop: 1, children: [visible.length === 0 && (_jsxs(Text, { color: "#8a8270", children: ["aucun match pour \"", query, "\""] })), visible.map((m, i) => {
                        const realIdx = start + i;
                        const active = realIdx === idx;
                        const speed = speedBadge(m.description);
                        return (_jsxs(Box, { children: [_jsx(Text, { color: active ? "#e27649" : "#4a4239", children: active ? "›" : " " }), _jsxs(Text, { color: active ? "#f6f1e8" : "#bdb3a1", children: [" ", m.id.padEnd(55)] }), _jsx(Text, { color: providerColor(m.provider), children: m.provider }), _jsxs(Text, { color: "#8a8270", children: ["  ", m.category] }), speed && (_jsxs(Text, { color: speed.color, children: ["  (", speed.label, ")"] }))] }, m.id));
                    })] }), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { color: "#8a8270", children: [filtered.length, " match \u00B7 \u2191\u2193 naviguer \u00B7 Enter valider \u00B7 Esc annuler"] }) })] }));
}
