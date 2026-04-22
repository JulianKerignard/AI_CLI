import React, { useEffect, useState } from "react";
import { Box, useStdout } from "ink";
import { HistoryView, StreamingView } from "./HistoryView.js";
import { InputBox } from "./InputBox.js";
import { StatusLine } from "./StatusLine.js";
import { inputController } from "./input-controller.js";
import { pickerController } from "./picker-controller.js";
import { ModelPicker } from "./ModelPicker.js";

// Layout :
// ┌───────────────────────────┐
// │ HistoryView (Static)      │  ← items figés, scrollent naturellement
// │ StreamingView             │  ← assistant streamant, mutable
// ├───────────────────────────┤
// │ InputBox (bordure)        │  ← zone de saisie toujours visible
// │ StatusLine (4 lignes)     │  ← status en dessous, toujours visible
// └───────────────────────────┘

export function App() {
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

  return (
    <Box flexDirection="column">
      <HistoryView />
      <StreamingView />
      {pickerActive ? (
        <ModelPicker
          items={pickerActive.items}
          initial={pickerActive.initial}
          onChoose={(id) => pickerController.close(id)}
        />
      ) : (
        <InputBox
          disabled={inputDisabled}
          placeholder="écris un prompt ou /help"
          onSubmit={(line) => inputController.submit(line)}
          onInterrupt={() => inputController.interrupt()}
        />
      )}
      <StatusLine columns={columns} />
    </Box>
  );
}
