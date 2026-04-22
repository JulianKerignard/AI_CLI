import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { colors as c } from "./theme.js";
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
export function InputBox({ disabled, onSubmit, onInterrupt, placeholder, history, }) {
    const [value, setValue] = useState("");
    const [cursor, setCursor] = useState(0);
    // Navigation historique : idx=null hors navigation, sinon index dans
    // history.snapshot(). draft = snapshot du value au 1er ↑.
    const [historyIdx, setHistoryIdx] = useState(null);
    const [draft, setDraft] = useState("");
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
        // ↑ : en multi-ligne, delegate vertical move si possible ; sinon history.prev
        if (key.upArrow) {
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
        // ↓ : en multi-ligne, delegate vertical down ; sinon history.next
        if (key.downArrow) {
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
    return (_jsx(Box, { borderStyle: "round", borderColor: disabled ? c.borderDim : c.border, paddingX: 1, flexDirection: "column", children: disabled ? (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: c.inkFaint, children: ["\u203A", "  "] }), _jsx(Text, { color: c.inkFaint, children: "\u2026en cours \u2014 attend la fin de g\u00E9n\u00E9ration" })] })) : showPlaceholder ? (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: c.accent, children: ["\u203A", "  "] }), _jsx(Text, { color: c.inkFaint, children: placeholder })] })) : (rendered.map((line, i) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: c.accent, children: i === 0 ? "›  " : "   " }), line.caretCol < 0 ? (_jsx(Text, { children: line.text || " " })) : (_jsxs(Text, { children: [line.text.slice(0, line.caretCol), _jsx(Text, { inverse: true, children: line.text.slice(line.caretCol, line.caretCol + 1) || " " }), line.text.slice(line.caretCol + 1)] }))] }, i)))) }));
}
