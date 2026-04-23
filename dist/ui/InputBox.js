import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { colors as c } from "./theme.js";
import { getSlashCommands } from "./slash-store.js";
// Max lignes visibles dans le popup autocomplete /slash
const MAX_SLASH_ROWS = 8;
// Saisie avec bordure (style Claude Code). Features :
// - Multi-ligne : `\`+Enter insère un \n, Enter seul submit
// - Paste multi-ligne : les \n dans l'input sont insérés tels quels
// - Historique ↑↓ : navigation dans InputHistory, avec draft preservation.
//   En multi-ligne, ↑ déplace le cursor vertical si possible, sinon
//   délègue à history.prev(). Idem ↓.
// - Cursor visible : caret inverse sur la ligne/colonne courante
// - Max 10 lignes visibles (scroll interne par cursorRow)
//
// Enter comportement :
//   - Si value se termine par `\` : strip le `\` et insère `\n` (comme bash)
//   - Sinon : submit
//
// Ctrl-C : onInterrupt (le REPL compte les doubles Ctrl-C pour quitter)
const MAX_VISIBLE_ROWS = 10;
// Convertit la position cursor (index dans value) en {row, col} en
// comptant les \n. Utile pour savoir si on est en haut / en bas du texte.
function cursorRowCol(value, cursor) {
    let row = 0;
    let col = 0;
    for (let i = 0; i < cursor; i++) {
        if (value[i] === "\n") {
            row++;
            col = 0;
        }
        else {
            col++;
        }
    }
    return { row, col };
}
// Compte le nombre total de lignes dans value (1 si pas de \n).
function lineCount(value) {
    let n = 1;
    for (const c of value)
        if (c === "\n")
            n++;
    return n;
}
// Cherche la position équivalente (même col si possible) sur la ligne
// précédente/suivante. Retourne null si on est déjà au bord.
function moveCursorVertical(value, cursor, delta) {
    const { row, col } = cursorRowCol(value, cursor);
    const targetRow = row + delta;
    if (targetRow < 0)
        return null;
    // Split ONE fois, accéder par index. Plus simple et correct pour tous
    // les cas (targetRow=0, dernière ligne, lignes vides).
    const lines = value.split("\n");
    if (targetRow >= lines.length)
        return null;
    // Offset du début de targetRow = somme des longueurs + \n des lignes précédentes.
    let startOfTarget = 0;
    for (let i = 0; i < targetRow; i++) {
        startOfTarget += lines[i].length + 1; // +1 pour le \n
    }
    const targetLen = lines[targetRow].length;
    return startOfTarget + Math.min(col, targetLen);
}
export function InputBox({ disabled, onSubmit, onInterrupt, onCyclePermissionMode, placeholder, history, }) {
    const [value, setValue] = useState("");
    const [cursor, setCursor] = useState(0);
    // Navigation historique : idx=null hors navigation, sinon index dans
    // history.snapshot(). draft = snapshot du value au 1er ↑.
    const [historyIdx, setHistoryIdx] = useState(null);
    const [draft, setDraft] = useState("");
    // Slash autocomplete : index de la commande sélectionnée dans le popup.
    const [slashIdx, setSlashIdx] = useState(0);
    // Popup slash actif : value commence par "/" sans espace ni newline
    // (= on tape le nom de commande). Filtre les commandes par préfixe.
    const slashMatches = useMemo(() => {
        if (!value.startsWith("/"))
            return [];
        const rest = value.slice(1);
        if (rest.includes(" ") || rest.includes("\n"))
            return [];
        const q = rest.toLowerCase();
        const all = getSlashCommands();
        const matches = all.filter((cmd) => cmd.name.toLowerCase().startsWith(q));
        // Fallback : si aucun match exact, essaie "contains" (tolère les typos).
        if (matches.length === 0 && q.length > 0) {
            return all.filter((cmd) => cmd.name.toLowerCase().includes(q));
        }
        return matches;
    }, [value]);
    const slashActive = slashMatches.length > 0;
    // Clamp slashIdx si la liste raccourcit.
    const currentSlashIdx = slashActive
        ? Math.min(slashIdx, slashMatches.length - 1)
        : 0;
    const exitHistory = useCallback(() => {
        if (historyIdx !== null) {
            setHistoryIdx(null);
            history?.resetCursor();
        }
    }, [historyIdx, history]);
    const submit = useCallback(() => {
        const v = value;
        setValue("");
        setCursor(0);
        setHistoryIdx(null);
        setDraft("");
        history?.resetCursor();
        onSubmit(v);
    }, [value, onSubmit, history]);
    useInput((input, key) => {
        if (disabled)
            return;
        // Ctrl-C en priorité.
        if (key.ctrl && input === "c") {
            onInterrupt();
            return;
        }
        // Shift+Tab → cycle permission mode (default → accept-edits → plan →
        // bypass → default). Le terminal envoie "\x1b[Z" pour Shift+Tab.
        // Test via la séquence brute car Ink n'expose pas key.shift fiablement.
        if (onCyclePermissionMode && (input === "\x1b[Z" || (key.tab && key.shift))) {
            onCyclePermissionMode();
            return;
        }
        // Slash autocomplete : Tab complète le nom, Enter si match exact = submit,
        // sinon complète aussi. Esc ferme le popup.
        if (slashActive) {
            const picked = slashMatches[currentSlashIdx];
            if (key.tab || (key.return && picked && `/${picked.name}` !== value)) {
                // Autocomplete : remplace value par "/<name> " (espace final pour args).
                const completed = `/${picked.name} `;
                setValue(completed);
                setCursor(completed.length);
                setSlashIdx(0);
                return;
            }
            if (key.escape) {
                // Ferme le popup sans vider value (user peut continuer à taper).
                // On ajoute juste un espace pour sortir de la condition slashActive.
                setValue(value + " ");
                setCursor(cursor + 1);
                return;
            }
        }
        // Enter : soit newline (si trailing `\`), soit submit.
        if (key.return) {
            if (value.endsWith("\\") && cursor === value.length) {
                // Strip le `\` trailing, insère \n à la place.
                const stripped = value.slice(0, -1);
                const newValue = stripped + "\n";
                setValue(newValue);
                setCursor(newValue.length);
                exitHistory();
                return;
            }
            submit();
            return;
        }
        // Ctrl-J : alternative power-user, insère \n direct.
        if (key.ctrl && input === "j") {
            const newValue = value.slice(0, cursor) + "\n" + value.slice(cursor);
            setValue(newValue);
            setCursor(cursor + 1);
            exitHistory();
            return;
        }
        if (key.backspace || key.delete) {
            if (cursor > 0) {
                setValue(value.slice(0, cursor - 1) + value.slice(cursor));
                setCursor(cursor - 1);
                exitHistory();
            }
            return;
        }
        if (key.leftArrow) {
            setCursor(Math.max(0, cursor - 1));
            return;
        }
        if (key.rightArrow) {
            setCursor(Math.min(value.length, cursor + 1));
            return;
        }
        // ↑ : si popup slash actif, navigue dedans. Sinon multi-ligne ou history.
        if (key.upArrow) {
            if (slashActive) {
                setSlashIdx((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                return;
            }
            const { row } = cursorRowCol(value, cursor);
            if (row > 0) {
                const next = moveCursorVertical(value, cursor, -1);
                if (next !== null)
                    setCursor(next);
                return;
            }
            // Row 0 → history
            if (!history)
                return;
            if (historyIdx === null) {
                setDraft(value);
            }
            const prev = history.prev();
            if (prev !== null) {
                setValue(prev);
                setCursor(prev.length);
                setHistoryIdx((i) => (i === null ? history.snapshot().length - 1 : i - 1));
            }
            return;
        }
        // ↓ : si popup slash actif, navigue dedans. Sinon multi-ligne ou history.
        if (key.downArrow) {
            if (slashActive) {
                setSlashIdx((i) => (i + 1) % slashMatches.length);
                return;
            }
            const { row } = cursorRowCol(value, cursor);
            const total = lineCount(value);
            if (row < total - 1) {
                const next = moveCursorVertical(value, cursor, 1);
                if (next !== null)
                    setCursor(next);
                return;
            }
            // Last row → history next
            if (!history)
                return;
            if (historyIdx === null)
                return; // pas en navigation
            const nxt = history.next();
            if (nxt === null || nxt === "") {
                // Retour au draft
                setValue(draft);
                setCursor(draft.length);
                setHistoryIdx(null);
                history.resetCursor();
            }
            else {
                setValue(nxt);
                setCursor(nxt.length);
                setHistoryIdx((i) => (i === null ? null : i + 1));
            }
            return;
        }
        // Ignore les meta/escape isolés.
        if (key.escape) {
            // Esc pendant navigation history = abandonne et revient au draft
            if (historyIdx !== null) {
                setValue(draft);
                setCursor(draft.length);
                setHistoryIdx(null);
                history?.resetCursor();
            }
            return;
        }
        if (key.meta)
            return;
        if (key.ctrl)
            return;
        // Char normal OU paste multi-ligne. Si input contient \n, on l'insère
        // tel quel (le user colle un snippet) — PAS de submit auto.
        if (input && input.length > 0) {
            setValue(value.slice(0, cursor) + input + value.slice(cursor));
            setCursor(cursor + input.length);
            exitHistory();
        }
    }, { isActive: !disabled });
    // Rendu multi-ligne : split par \n, place le caret inverse sur la ligne
    // contenant cursor à la bonne colonne.
    const rendered = useMemo(() => {
        const lines = value.split("\n");
        const cur = cursorRowCol(value, cursor);
        // Scroll : si plus de MAX_VISIBLE_ROWS, fenêtre centrée sur cur.row.
        let firstRow = 0;
        if (lines.length > MAX_VISIBLE_ROWS) {
            firstRow = Math.max(0, Math.min(cur.row - Math.floor(MAX_VISIBLE_ROWS / 2), lines.length - MAX_VISIBLE_ROWS));
        }
        const visible = lines.slice(firstRow, firstRow + MAX_VISIBLE_ROWS);
        return visible.map((line, i) => {
            const absRow = firstRow + i;
            if (absRow !== cur.row)
                return { text: line, caretCol: -1 };
            return { text: line, caretCol: cur.col };
        });
    }, [value, cursor]);
    const showPlaceholder = value.length === 0 && placeholder;
    // Popup slash : affiche les commandes matchées au-dessus de l'input.
    // Fenêtre scrollable centrée sur currentSlashIdx si plus de MAX_SLASH_ROWS.
    const slashWindow = useMemo(() => {
        if (!slashActive)
            return [];
        if (slashMatches.length <= MAX_SLASH_ROWS)
            return slashMatches;
        const half = Math.floor(MAX_SLASH_ROWS / 2);
        const first = Math.max(0, Math.min(currentSlashIdx - half, slashMatches.length - MAX_SLASH_ROWS));
        return slashMatches.slice(first, first + MAX_SLASH_ROWS);
    }, [slashMatches, currentSlashIdx, slashActive]);
    const slashWindowStart = slashActive
        ? Math.max(0, Math.min(currentSlashIdx - Math.floor(MAX_SLASH_ROWS / 2), Math.max(0, slashMatches.length - MAX_SLASH_ROWS)))
        : 0;
    return (_jsxs(Box, { flexDirection: "column", children: [slashActive && (_jsxs(Box, { borderStyle: "round", borderColor: c.borderDim, paddingX: 1, flexDirection: "column", marginBottom: 0, children: [slashWindow.map((cmd, i) => {
                        const absIdx = slashWindowStart + i;
                        const active = absIdx === currentSlashIdx;
                        return (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: active ? c.accent : c.inkFaint, children: active ? "›" : " " }), _jsxs(Text, { color: active ? c.ink : c.inkMuted, children: [" ", "/", cmd.name.padEnd(16)] }), _jsx(Text, { color: c.inkFaint, children: cmd.description })] }, cmd.name));
                    }), _jsx(Box, { children: _jsx(Text, { color: c.inkFaint, children: "\u2191\u2193 naviguer \u00B7 Tab/Enter compl\u00E9ter \u00B7 Esc fermer" }) })] })), _jsx(Box, { borderStyle: "round", borderColor: disabled ? c.borderDim : c.border, paddingX: 1, flexDirection: "column", children: disabled ? (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: c.inkFaint, children: ["\u203A", "  "] }), _jsx(Text, { color: c.inkFaint, children: "\u2026en cours \u2014 attend la fin de g\u00E9n\u00E9ration" })] })) : showPlaceholder ? (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: c.accent, children: ["\u203A", "  "] }), _jsx(Text, { color: c.inkFaint, children: placeholder })] })) : (rendered.map((line, i) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: c.accent, children: i === 0 ? "›  " : "   " }), line.caretCol < 0 ? (_jsx(Text, { children: line.text || " " })) : (_jsxs(Text, { children: [line.text.slice(0, line.caretCol), _jsx(Text, { inverse: true, children: line.text.slice(line.caretCol, line.caretCol + 1) || " " }), line.text.slice(line.caretCol + 1)] }))] }, i)))) })] }));
}
