import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout, useWindowSize } from "ink";
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
import { interruptController } from "./interrupt-controller.js";
import { c } from "./theme.js";
import { Header } from "./tui/Header.js";
import { Sidebar } from "./tui/Sidebar.js";
import { getAppVersion } from "../utils/paths.js";

// AppFullscreen — layout TUI panneaux pour mode alt-screen. Composé :
//
// ┌──────────────────────────────────────────────────────┐
// │ Header (1 row)                                       │
// ├────────────┬─────────────────────────────────────────┤
// │            │                                          │
// │  Sidebar   │  Main (HistoryView + StreamingView)     │
// │  (24 cols) │                                          │
// │            │                                          │
// ├────────────┴─────────────────────────────────────────┤
// │ InputBox (3 rows)                                    │
// │ StatusLine (2 rows)                                  │
// │ Footer keybindings (1 row)                           │
// └──────────────────────────────────────────────────────┘
//
// Le main reste sur HistoryView <Static> à cette étape (PR#1) — le
// scroll virtuel arrive en PR#3 via ScrollableBox. En conséquence : sur
// session longue, l'historique reste visible mais ne scrolle pas
// proprement dans la box height fixée. Acceptable v1, mergeable opt-in.

const SIDEBAR_WIDTH = 24;
const MIN_COLS = 60;
const MIN_ROWS = 20;

interface AppProps {
  history?: InputHistory;
}

export function AppFullscreen({ history }: AppProps = {}) {
  const { stdout } = useStdout();
  const { columns: cols, rows } = useWindowSize();
  const [inputDisabled, setInputDisabled] = useState<boolean>(false);
  const [showSidebar, setShowSidebar] = useState<boolean>(cols >= 100);

  useEffect(() => {
    const update = () => setInputDisabled(inputController.disabled);
    inputController.on("disabled-change", update);
    return () => {
      inputController.off("disabled-change", update);
    };
  }, []);

  // Picker / permission / ask / session controllers (identique App.tsx).
  const [pickerActive, setPickerActive] = useState(() => pickerController.getCurrent());
  useEffect(() => {
    const update = () => setPickerActive(pickerController.getCurrent());
    pickerController.on("change", update);
    return () => {
      pickerController.off("change", update);
    };
  }, []);

  const [permissionActive, setPermissionActive] = useState(() => permissionController.getCurrent());
  useEffect(() => {
    const update = () => setPermissionActive(permissionController.getCurrent());
    permissionController.on("change", update);
    return () => {
      permissionController.off("change", update);
    };
  }, []);

  const [sessionActive, setSessionActive] = useState(() => sessionController.getCurrent());
  useEffect(() => {
    const update = () => setSessionActive(sessionController.getCurrent());
    sessionController.on("change", update);
    return () => {
      sessionController.off("change", update);
    };
  }, []);

  const [askActive, setAskActive] = useState(() => askController.getCurrent());
  useEffect(() => {
    const update = () => setAskActive(askController.getCurrent());
    askController.on("change", update);
    return () => {
      askController.off("change", update);
    };
  }, []);

  // Esc → interrompt la génération (idem App.tsx).
  useInput(
    (_input, key) => {
      if (key.escape) {
        interruptController.request();
      }
      // Ctrl+B → toggle sidebar.
      if (key.ctrl && _input === "b") {
        setShowSidebar((s) => !s);
      }
    },
    { isActive: !permissionActive && !askActive && !sessionActive && !pickerActive },
  );

  // Listener resize stdout (Ink useWindowSize re-render auto, mais on
  // garde celui-ci pour cohérence avec App.tsx legacy si besoin).
  useEffect(() => {
    if (!stdout) return;
    const update = () => {
      // useWindowSize gère déjà le re-render — noop ici.
    };
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  // Terminal trop petit : refuse de rendre le layout, message explicite.
  if (cols < MIN_COLS || rows < MIN_ROWS) {
    return (
      <Box width={cols} height={rows} alignItems="center" justifyContent="center">
        <Text color={c.danger}>
          Terminal trop petit ({cols}×{rows}). Min {MIN_COLS}×{MIN_ROWS}.
        </Text>
      </Box>
    );
  }

  // Calcul des dimensions :
  // - Header   : 1 ligne
  // - Body     : flexGrow (rows - header - input - status - footer)
  // - Input    : 3 lignes (border + 1 ligne contenu, parfois multi-line)
  // - Status   : 2 lignes
  // - Footer   : 1 ligne
  const inputHeight = 3;
  const statusHeight = 2;
  const footerHeight = 1;
  const headerHeight = 1;
  const bodyHeight = Math.max(
    1,
    rows - headerHeight - inputHeight - statusHeight - footerHeight,
  );
  const sidebarVisible = showSidebar && cols >= 100;
  const mainWidth = sidebarVisible ? cols - SIDEBAR_WIDTH : cols;

  // Modal actif (picker/permission/ask/session) → remplace le main panel.
  // À PR#2 ce sera un vrai overlay centré ; pour PR#1 on garde le pattern
  // existant (le picker remplace l'input et prend la place du body).
  const modal =
    permissionActive ? (
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
        showCwd={sessionActive.showCwd}
        onChoose={(p) => sessionController.close(p)}
      />
    ) : pickerActive ? (
      <ModelPicker
        items={pickerActive.items}
        initial={pickerActive.initial}
        onChoose={(id) => pickerController.close(id)}
      />
    ) : null;

  return (
    <Box width={cols} height={rows} flexDirection="column">
      <Header
        appName="AICLI"
        version={getAppVersion()}
        model="—"
        mode="—"
        cols={cols}
      />
      <Box flexDirection="row" height={bodyHeight}>
        {sidebarVisible && <Sidebar width={SIDEBAR_WIDTH} height={bodyHeight} />}
        <Box flexDirection="column" width={mainWidth} height={bodyHeight} paddingX={1}>
          {/* HistoryView Static + StreamingView (scroll terminal natif
              cassé en alt-screen — PR#3 introduit ScrollableBox). */}
          <HistoryView />
          <StreamingView />
        </Box>
      </Box>
      {modal ? (
        <Box flexDirection="column">{modal}</Box>
      ) : (
        <InputBox
          disabled={inputDisabled}
          placeholder={
            cols >= 100
              ? "écris un prompt ou /help · \\+Enter = nouvelle ligne · Ctrl+U = vider · Shift+Tab = mode"
              : "écris un prompt ou /help"
          }
          history={history}
          onSubmit={(line) => inputController.submit(line)}
          onInterrupt={() => inputController.interrupt()}
          onCyclePermissionMode={() => inputController.cyclePermissionMode()}
        />
      )}
      <StatusLine columns={cols} />
      {!pickerActive && !permissionActive && !askActive && !sessionActive && (
        <Box>
          <Text color={c.inkDim}>
            <Text color={c.accent}>⏎</Text>
            <Text color={c.inkFaint}> send</Text>
            <Text color={c.inkFaint}>{"  ·  "}</Text>
            <Text color={c.inkMuted}>⇧⇥</Text>
            <Text color={c.inkFaint}> mode</Text>
            <Text color={c.inkFaint}>{"  ·  "}</Text>
            <Text color={c.inkMuted}>^B</Text>
            <Text color={c.inkFaint}> sidebar</Text>
            <Text color={c.inkFaint}>{"  ·  "}</Text>
            <Text color={c.inkMuted}>esc</Text>
            <Text color={c.inkFaint}> stop</Text>
            <Text color={c.inkFaint}>{"  ·  "}</Text>
            <Text color={c.inkMuted}>/help</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}
