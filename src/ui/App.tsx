import React, { useEffect, useState } from "react";
import { Box, useStdout } from "ink";
import { HistoryView, StreamingView } from "./HistoryView.js";
import { InputBox } from "./InputBox.js";
import { StatusLine } from "./StatusLine.js";
import { inputController } from "./input-controller.js";
import type { InputHistory } from "../utils/history.js";
import { pickerController } from "./picker-controller.js";
import { ModelPicker } from "./ModelPicker.js";
import { permissionController } from "./permission-controller.js";
import { PermissionPicker } from "./PermissionPicker.js";
import { sessionController } from "./session-controller.js";
import { SessionPicker } from "./SessionPicker.js";
import { askController } from "./ask-controller.js";
import { AskPicker } from "./AskPicker.js";

// Layout :
// ┌───────────────────────────┐
// │ HistoryView (Static)      │  ← items figés, scrollent naturellement
// │ StreamingView             │  ← assistant streamant, mutable
// ├───────────────────────────┤
// │ InputBox (bordure)        │  ← zone de saisie toujours visible
// │ StatusLine (4 lignes)     │  ← status en dessous, toujours visible
// └───────────────────────────┘

interface AppProps {
  history?: InputHistory;
}

export function App({ history }: AppProps = {}) {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState<number>(stdout?.columns ?? 100);
  const [inputDisabled, setInputDisabled] = useState<boolean>(false);

  useEffect(() => {
    if (!stdout) return;
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
  const [pickerActive, setPickerActive] = useState(
    () => pickerController.getCurrent(),
  );
  useEffect(() => {
    const update = () => setPickerActive(pickerController.getCurrent());
    pickerController.on("change", update);
    return () => {
      pickerController.off("change", update);
    };
  }, []);

  // Permission prompt actif (ex: askPermission pour un tool call).
  const [permissionActive, setPermissionActive] = useState(
    () => permissionController.getCurrent(),
  );
  useEffect(() => {
    const update = () => setPermissionActive(permissionController.getCurrent());
    permissionController.on("change", update);
    return () => {
      permissionController.off("change", update);
    };
  }, []);

  // Session picker actif (/resume).
  const [sessionActive, setSessionActive] = useState(
    () => sessionController.getCurrent(),
  );
  useEffect(() => {
    const update = () => setSessionActive(sessionController.getCurrent());
    sessionController.on("change", update);
    return () => {
      sessionController.off("change", update);
    };
  }, []);

  // Ask picker actif (tool AskUser posé par l'agent).
  const [askActive, setAskActive] = useState(() => askController.getCurrent());
  useEffect(() => {
    const update = () => setAskActive(askController.getCurrent());
    askController.on("change", update);
    return () => {
      askController.off("change", update);
    };
  }, []);

  return (
    <Box flexDirection="column">
      <HistoryView />
      <StreamingView />
      {permissionActive ? (
        <PermissionPicker
          toolName={permissionActive.toolName}
          category={permissionActive.category}
          input={permissionActive.input}
          onChoose={(d) => permissionController.close(d)}
        />
      ) : askActive ? (
        <AskPicker
          question={askActive.question}
          options={askActive.options}
          onAnswer={(a) => askController.close(a)}
        />
      ) : sessionActive ? (
        <SessionPicker
          items={sessionActive.items}
          onChoose={(p) => sessionController.close(p)}
        />
      ) : pickerActive ? (
        <ModelPicker
          items={pickerActive.items}
          initial={pickerActive.initial}
          onChoose={(id) => pickerController.close(id)}
        />
      ) : (
        <InputBox
          disabled={inputDisabled}
          placeholder="écris un prompt ou /help · \\+Enter = nouvelle ligne · Shift+Tab = mode"
          history={history}
          onSubmit={(line) => inputController.submit(line)}
          onInterrupt={() => inputController.interrupt()}
          onCyclePermissionMode={() => inputController.cyclePermissionMode()}
        />
      )}
      <StatusLine columns={columns} />
    </Box>
  );
}
