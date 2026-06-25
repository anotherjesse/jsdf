import {
  type AppHealthWindow,
  activeElementToken,
  nextFrame,
  readAppHealth,
  safeFrameDocument,
  safeFrameWindow,
  settleFrame,
} from "./app-health-frame-runtime";

export interface AppHealthSourceDialogFocusVerification {
  loadShortcut: string;
  shortcutPreventedDefault: boolean;
  onOpen: string;
  afterClose: string;
}

export interface AppHealthSourceHintsShortcutSwitchVerification {
  shortcut: string;
  beforePressed: string;
  afterPressed: string;
  restoredPressed: string;
  preventedDefault: boolean;
  restoredDefault: boolean;
  status: string;
}

export interface AppHealthPrettifyShortcutVerification {
  shortcut: string;
  preventedDefault: boolean;
  editablePreventedDefault: boolean;
  status: string;
}

export interface AppHealthGraphFilterShortcutVerification {
  shortcut: string;
  slashPreventedDefault: boolean;
  commandPreventedDefault: boolean;
  editablePreventedDefault: boolean;
  slashFocus: string;
  commandFocus: string;
}

export interface AppHealthEditorModeShortcutSwitchVerification {
  codeShortcut: string;
  graphShortcut: string;
  codePreventedDefault: boolean;
  graphPreventedDefault: boolean;
  afterCodeView: string;
  afterGraphView: string;
  codeVisible: boolean;
  graphVisible: boolean;
}

export async function verifySourceDialogFocus(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthSourceDialogFocusVerification> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = { loadShortcut: "", shortcutPreventedDefault: false, onOpen: "", afterClose: "" };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for source dialog focus verification");
    return empty;
  }

  const loadButton = frameDocument.querySelector<HTMLButtonElement>("#loadSourceButton");
  const closeButton = frameDocument.querySelector<HTMLButtonElement>("#closeSourceDialogButton");
  if (!loadButton || !closeButton) {
    errors.push("app frame missing source dialog focus controls");
    return empty;
  }

  const loadShortcut = loadButton.getAttribute("aria-keyshortcuts") ?? "";
  if (!loadShortcut.includes("Control+O") || !loadShortcut.includes("Meta+O")) {
    errors.push(`load button advertised shortcut as ${loadShortcut || "nothing"}`);
  }

  const KeyboardEventCtor = (frameWindow as AppHealthWindow & { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  const shortcutPreventedDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "o",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }));
  if (!shortcutPreventedDefault) {
    errors.push("load shortcut did not prevent the browser default");
  }
  await nextFrame(frameWindow);
  await nextFrame(frameWindow);
  const onOpen = activeElementToken(frameDocument);
  if (onOpen !== "source-search-input") {
    errors.push(`source dialog focused ${onOpen || "nothing"} on open`);
  }

  closeButton.click();
  await settleFrame(frameWindow);
  const afterClose = activeElementToken(frameDocument);
  const dialogOpenAfterClose = Boolean(frameDocument.querySelector<HTMLDialogElement>("#sourceDialog")?.open);
  if (afterClose !== "loadSourceButton" && dialogOpenAfterClose) {
    errors.push(`source dialog restored focus to ${afterClose || "nothing"}`);
  }

  return { loadShortcut, shortcutPreventedDefault, onOpen, afterClose };
}

export async function verifySourceHintsShortcutSwitch(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthSourceHintsShortcutSwitchVerification> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = {
    shortcut: "",
    beforePressed: "",
    afterPressed: "",
    restoredPressed: "",
    preventedDefault: false,
    restoredDefault: false,
    status: "",
  };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for graph hints shortcut verification");
    return empty;
  }

  const hintsButton = frameDocument.querySelector<HTMLButtonElement>("#sourceHintsButton");
  const status = frameDocument.querySelector<HTMLElement>("#editorStatus");
  if (!hintsButton || !status) {
    errors.push("app frame missing graph hints shortcut controls");
    return empty;
  }

  const shortcut = hintsButton.getAttribute("aria-keyshortcuts") ?? "";
  const beforePressed = hintsButton.getAttribute("aria-pressed") ?? "";
  const KeyboardEventCtor = (frameWindow as AppHealthWindow & { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  if (hintsButton.hidden || hintsButton.disabled) {
    const preventedDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
      key: "h",
      code: "KeyH",
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await nextFrame(frameWindow);
    const statusText = status.textContent ?? "";
    if (shortcut) errors.push(`simple editor graph hints advertised shortcut as ${shortcut}`);
    if (preventedDefault) errors.push("simple editor graph hints shortcut prevented the browser default");
    return {
      shortcut,
      beforePressed,
      afterPressed: hintsButton.getAttribute("aria-pressed") ?? "",
      restoredPressed: beforePressed,
      preventedDefault,
      restoredDefault: false,
      status: statusText,
    };
  }
  const preventedDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "h",
    code: "KeyH",
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  }));
  await nextFrame(frameWindow);
  const afterPressed = hintsButton.getAttribute("aria-pressed") ?? "";
  const statusText = status.textContent ?? "";

  const restoredDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "h",
    code: "KeyH",
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  }));
  await nextFrame(frameWindow);
  const restoredPressed = hintsButton.getAttribute("aria-pressed") ?? "";

  if (shortcut !== "Alt+Shift+H") errors.push(`graph hints button advertised shortcut as ${shortcut || "nothing"}`);
  if (!preventedDefault) errors.push("graph hints shortcut did not prevent the browser default");
  if (!restoredDefault) errors.push("graph hints restore shortcut did not prevent the browser default");
  if (afterPressed === beforePressed) {
    errors.push(`graph hints shortcut left aria-pressed at ${afterPressed || "nothing"}`);
  }
  if (restoredPressed !== beforePressed) {
    errors.push(`graph hints shortcut restored aria-pressed to ${restoredPressed || "nothing"} instead of ${beforePressed || "nothing"}`);
  }
  if (!statusText.includes("Graph hints")) {
    errors.push(`graph hints shortcut status rendered ${statusText || "nothing"}`);
  }

  return {
    shortcut,
    beforePressed,
    afterPressed,
    restoredPressed,
    preventedDefault,
    restoredDefault,
    status: statusText,
  };
}

export async function verifyPrettifyShortcut(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthPrettifyShortcutVerification> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = {
    shortcut: "",
    preventedDefault: false,
    editablePreventedDefault: false,
    status: "",
  };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for prettify shortcut verification");
    return empty;
  }

  const prettifyButton = frameDocument.querySelector<HTMLButtonElement>("#prettifySourceButton");
  const status = frameDocument.querySelector<HTMLElement>("#editorStatus");
  const documentName = frameDocument.querySelector<HTMLInputElement>("#documentNameInput");
  if (!prettifyButton || !status || !documentName) {
    errors.push("app frame missing prettify shortcut controls");
    return empty;
  }

  const shortcut = prettifyButton.getAttribute("aria-keyshortcuts") ?? "";
  const KeyboardEventCtor = (frameWindow as AppHealthWindow & { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  const preventedDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "f",
    code: "KeyF",
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  }));
  await settleFrame(frameWindow);
  const statusText = status.textContent ?? "";

  const editablePreventedDefault = !documentName.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "f",
    code: "KeyF",
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  }));

  if (shortcut !== "Alt+Shift+F") errors.push(`prettify button advertised shortcut as ${shortcut || "nothing"}`);
  if (!preventedDefault) errors.push("prettify shortcut did not prevent the browser default");
  if (editablePreventedDefault) errors.push("prettify shortcut intercepted an editable text field");
  if (statusText !== "Prettified" && statusText !== "Already pretty") {
    errors.push(`prettify shortcut status rendered ${statusText || "nothing"}`);
  }

  return {
    shortcut,
    preventedDefault,
    editablePreventedDefault,
    status: statusText,
  };
}

export async function verifyGraphFilterShortcut(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthGraphFilterShortcutVerification> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = {
    shortcut: "",
    slashPreventedDefault: false,
    commandPreventedDefault: false,
    editablePreventedDefault: false,
    slashFocus: "",
    commandFocus: "",
  };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for graph filter shortcut verification");
    return empty;
  }

  const graphMode = frameDocument.querySelector<HTMLButtonElement>("#graphModeButton");
  const filterInput = frameDocument.querySelector<HTMLInputElement>(".graph-filter-input");
  const documentName = frameDocument.querySelector<HTMLInputElement>("#documentNameInput");
  if (!graphMode || !filterInput || !documentName) {
    errors.push("app frame missing graph filter shortcut controls");
    return empty;
  }

  graphMode.click();
  await settleFrame(frameWindow);

  const shortcut = filterInput.getAttribute("aria-keyshortcuts") ?? "";
  const KeyboardEventCtor = (frameWindow as AppHealthWindow & { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  const slashPreventedDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "/",
    code: "Slash",
    bubbles: true,
    cancelable: true,
  }));
  await settleFrame(frameWindow);
  const slashFocus = frameDocument.activeElement === filterInput ? "graph-filter-input" : activeElementToken(frameDocument);

  filterInput.blur();
  const commandPreventedDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "f",
    code: "KeyF",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }));
  await settleFrame(frameWindow);
  const commandFocus = frameDocument.activeElement === filterInput ? "graph-filter-input" : activeElementToken(frameDocument);

  documentName.focus();
  const editablePreventedDefault = !documentName.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "f",
    code: "KeyF",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }));

  if (shortcut !== "Control+F Meta+F /") errors.push(`graph filter advertised shortcut as ${shortcut || "nothing"}`);
  if (!slashPreventedDefault) errors.push("graph filter slash shortcut did not prevent the browser default");
  if (!commandPreventedDefault) errors.push("graph filter command shortcut did not prevent the browser default");
  if (editablePreventedDefault) errors.push("graph filter shortcut intercepted an editable text field");
  if (slashFocus !== "graph-filter-input") errors.push(`graph filter slash shortcut focused ${slashFocus || "nothing"}`);
  if (commandFocus !== "graph-filter-input") errors.push(`graph filter command shortcut focused ${commandFocus || "nothing"}`);

  return {
    shortcut,
    slashPreventedDefault,
    commandPreventedDefault,
    editablePreventedDefault,
    slashFocus,
    commandFocus,
  };
}

export async function verifyEditorModeShortcutSwitch(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthEditorModeShortcutSwitchVerification> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = {
    codeShortcut: "",
    graphShortcut: "",
    codePreventedDefault: false,
    graphPreventedDefault: false,
    afterCodeView: "",
    afterGraphView: "",
    codeVisible: false,
    graphVisible: false,
  };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for editor mode shortcut verification");
    return empty;
  }

  const codeMode = frameDocument.querySelector<HTMLButtonElement>("#codeModeButton");
  const graphMode = frameDocument.querySelector<HTMLButtonElement>("#graphModeButton");
  const codePanel = frameDocument.querySelector<HTMLElement>("#codePanel");
  const graphPanel = frameDocument.querySelector<HTMLElement>("#graphPanel");
  if (!codeMode || !graphMode || !codePanel || !graphPanel) {
    errors.push("app frame missing editor mode shortcut controls");
    return empty;
  }

  const codeShortcut = codeMode.getAttribute("aria-keyshortcuts") ?? "";
  const graphShortcut = graphMode.getAttribute("aria-keyshortcuts") ?? "";
  const KeyboardEventCtor = (frameWindow as AppHealthWindow & { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  const codePreventedDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "1",
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  }));
  await nextFrame(frameWindow);
  await nextFrame(frameWindow);
  const afterCodeView = readAppHealth(frame)?.editorView ?? "";
  const codeVisible = !codePanel.classList.contains("hidden");

  const graphPreventedDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "2",
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  }));
  await nextFrame(frameWindow);
  await nextFrame(frameWindow);
  const afterGraphView = readAppHealth(frame)?.editorView ?? "";
  const graphVisible = !graphPanel.classList.contains("hidden");

  if (!codeShortcut.includes("Control+Alt+1") || !codeShortcut.includes("Meta+Alt+1")) {
    errors.push(`code mode button advertised shortcut as ${codeShortcut || "nothing"}`);
  }
  if (!graphShortcut.includes("Control+Alt+2") || !graphShortcut.includes("Meta+Alt+2")) {
    errors.push(`graph mode button advertised shortcut as ${graphShortcut || "nothing"}`);
  }
  if (!codePreventedDefault) errors.push("code mode shortcut did not prevent the browser default");
  if (!graphPreventedDefault) errors.push("graph mode shortcut did not prevent the browser default");
  if (afterCodeView !== "code") errors.push(`code mode shortcut left editor in ${afterCodeView || "unknown"} view`);
  if (afterGraphView !== "graph") errors.push(`graph mode shortcut left editor in ${afterGraphView || "unknown"} view`);
  if (!codeVisible) errors.push("code mode shortcut left code panel hidden");
  if (!graphVisible) errors.push("graph mode shortcut left graph panel hidden");

  return {
    codeShortcut,
    graphShortcut,
    codePreventedDefault,
    graphPreventedDefault,
    afterCodeView,
    afterGraphView,
    codeVisible,
    graphVisible,
  };
}
