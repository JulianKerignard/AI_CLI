import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
// Picker natif Ink pour askPermission (remplace @inquirer/select qui
// créait des artefacts visuels en cohabitant avec Ink). 4 choix
// classiques y/session/persist/deny + navigation ↑↓ + Enter valider.
const CHOICES = [
    { value: "allow", label: "Yes", hint: "une fois" },
    { value: "allow-session", label: "Always this session", hint: "pour tout ce REPL" },
    { value: "allow-persist", label: "Persist always", hint: "enregistré" },
    { value: "deny", label: "No", hint: "refuser" },
];
function categoryColor(c) {
    return c === "execute" ? "#c76a5f" : c === "edit" ? "#ec9470" : "#bdb3a1";
}
export function PermissionPicker({ toolName, category, input, onChoose }) {
    const [idx, setIdx] = useState(0);
    useInput((inp, key) => {
        if (key.escape) {
            onChoose("deny");
            return;
        }
        if (key.return) {
            onChoose(CHOICES[idx].value);
            return;
        }
        if (key.upArrow) {
            setIdx((i) => (i - 1 + CHOICES.length) % CHOICES.length);
            return;
        }
        if (key.downArrow) {
            setIdx((i) => (i + 1) % CHOICES.length);
            return;
        }
        // Raccourcis clavier y/a/p/n/o
        if (!inp)
            return;
        const c = inp.toLowerCase();
        if (c === "y" || c === "o")
            onChoose("allow");
        else if (c === "a")
            onChoose("allow-session");
        else if (c === "p")
            onChoose("allow-persist");
        else if (c === "n")
            onChoose("deny");
    });
    const inputLines = Object.entries(input).slice(0, 4).map(([k, v]) => {
        const val = typeof v === "string"
            ? v.length > 120
                ? v.slice(0, 120) + "…"
                : v.replace(/\n/g, "⏎")
            : JSON.stringify(v).slice(0, 120);
        return { k, v: val };
    });
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: "#e27649", paddingX: 1, children: [_jsxs(Box, { children: [_jsx(Text, { color: "#e27649", children: "\u26A0 " }), _jsx(Text, { color: "#f6f1e8", bold: true, children: "Permission requise" }), _jsx(Text, { color: "#8a8270", children: " \u00B7 " }), _jsx(Text, { color: categoryColor(category), children: category }), _jsx(Text, { color: "#8a8270", children: " \u00B7 " }), _jsx(Text, { color: "#ec9470", bold: true, children: toolName })] }), inputLines.length > 0 && (_jsx(Box, { flexDirection: "column", marginTop: 1, children: inputLines.map(({ k, v }) => (_jsxs(Box, { children: [_jsx(Text, { color: "#bdb3a1", children: "  " + k + "  " }), _jsx(Text, { color: "#f6f1e8", children: v })] }, k))) })), _jsx(Box, { flexDirection: "column", marginTop: 1, children: CHOICES.map((c, i) => (_jsxs(Box, { children: [_jsx(Text, { color: i === idx ? "#e27649" : "#4a4239", children: i === idx ? "›" : " " }), _jsx(Text, { color: i === idx ? "#f6f1e8" : "#bdb3a1", children: " " + c.label.padEnd(22) }), _jsx(Text, { color: "#8a8270", children: c.hint })] }, c.value))) }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: "#8a8270", children: "\u2191\u2193 \u00B7 Enter valider \u00B7 Esc refuser \u00B7 raccourcis y / a / p / n" }) })] }));
}
