import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Box, useStdout } from "ink";
import { HistoryView, StreamingView } from "./HistoryView.js";
import { InputBox } from "./InputBox.js";
import { StatusLine } from "./StatusLine.js";
import { inputController } from "./input-controller.js";
import { pickerController } from "./picker-controller.js";
import { ModelPicker } from "./ModelPicker.js";
import { permissionController } from "./permission-controller.js";
import { PermissionPicker } from "./PermissionPicker.js";
import { sessionController } from "./session-controller.js";
import { SessionPicker } from "./SessionPicker.js";
export function App({ history } = {}) {
    const { stdout } = useStdout();
    const [columns, setColumns] = useState(stdout?.columns ?? 100);
    const [inputDisabled, setInputDisabled] = useState(false);
    useEffect(() => {
        if (!stdout)
            return;
        const update = () => setColumns(stdout.columns ?? 100);
        stdout.on("resize", update);
        return () => {
            stdout.off("resize", update);
        };
    }, [stdout]);
    useEffect(() => {
        const update = () => setInputDisabled(inputController.disabled);
        inputController.on("disabled-change", update);
        return () => {
            inputController.off("disabled-change", update);
        };
    }, []);
    // Picker actif (ex: /model) → remplace temporairement l'InputBox.
    const [pickerActive, setPickerActive] = useState(() => pickerController.getCurrent());
    useEffect(() => {
        const update = () => setPickerActive(pickerController.getCurrent());
        pickerController.on("change", update);
        return () => {
            pickerController.off("change", update);
        };
    }, []);
    // Permission prompt actif (ex: askPermission pour un tool call).
    const [permissionActive, setPermissionActive] = useState(() => permissionController.getCurrent());
    useEffect(() => {
        const update = () => setPermissionActive(permissionController.getCurrent());
        permissionController.on("change", update);
        return () => {
            permissionController.off("change", update);
        };
    }, []);
    // Session picker actif (/resume).
    const [sessionActive, setSessionActive] = useState(() => sessionController.getCurrent());
    useEffect(() => {
        const update = () => setSessionActive(sessionController.getCurrent());
        sessionController.on("change", update);
        return () => {
            sessionController.off("change", update);
        };
    }, []);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(HistoryView, {}), _jsx(StreamingView, {}), permissionActive ? (_jsx(PermissionPicker, { toolName: permissionActive.toolName, category: permissionActive.category, input: permissionActive.input, onChoose: (d) => permissionController.close(d) })) : sessionActive ? (_jsx(SessionPicker, { items: sessionActive.items, onChoose: (p) => sessionController.close(p) })) : pickerActive ? (_jsx(ModelPicker, { items: pickerActive.items, initial: pickerActive.initial, onChoose: (id) => pickerController.close(id) })) : (_jsx(InputBox, { disabled: inputDisabled, placeholder: "\u00E9cris un prompt ou /help \u00B7 \\\\+Enter = nouvelle ligne \u00B7 Shift+Tab = mode", history: history, onSubmit: (line) => inputController.submit(line), onInterrupt: () => inputController.interrupt(), onCyclePermissionMode: () => inputController.cyclePermissionMode() })), _jsx(StatusLine, { columns: columns })] }));
}
