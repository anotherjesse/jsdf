import type { AppHealthDiagnostics } from "../editor/app-health";
import {
  type AppHealthWindow,
  activeElementToken,
  dispatchInput,
  dispatchPointer,
  nextFrame,
  readAppHealth,
  safeFrameDocument,
  safeFrameWindow,
  selectedGraphNodeHasFocus,
  settleFrame,
  waitForAppHealth,
  waitForFrameLoad,
} from "./app-health-frame-runtime";
import {
  type AppHealthDomSummary,
  summarizeFrameDom,
  verifyDom,
  verifyHealth,
} from "./app-health-summary-runtime";

export interface AppHealthRuntimeVerification {
  ok: boolean;
  loadMs: number;
  health: AppHealthDiagnostics | null;
  dom: AppHealthDomSummary;
  graphHoverStatus: {
    before: string;
    during: string;
    after: string;
  };
  sourceDialogFocus: {
    loadShortcut: string;
    shortcutPreventedDefault: boolean;
    onOpen: string;
    afterClose: string;
  };
  sourceHintsShortcutSwitch: {
    shortcut: string;
    beforePressed: string;
    afterPressed: string;
    restoredPressed: string;
    preventedDefault: boolean;
    restoredDefault: boolean;
    status: string;
  };
  prettifyShortcut: {
    shortcut: string;
    preventedDefault: boolean;
    editablePreventedDefault: boolean;
    status: string;
  };
  graphFilterShortcut: {
    shortcut: string;
    slashPreventedDefault: boolean;
    commandPreventedDefault: boolean;
    editablePreventedDefault: boolean;
    slashFocus: string;
    commandFocus: string;
  };
  editorModeShortcutSwitch: {
    codeShortcut: string;
    graphShortcut: string;
    codePreventedDefault: boolean;
    graphPreventedDefault: boolean;
    afterCodeView: string;
    afterGraphView: string;
    codeVisible: boolean;
    graphVisible: boolean;
  };
  selectionFocusButton: {
    labelBefore: string;
    labelAfterGraph: string;
    labelAfterCode: string;
    shortcut: string;
    shortcutPreventedDefault: boolean;
    graphView: string;
    graphVisible: boolean;
    graphFocusedSelectedNode: boolean;
    codeView: string;
    codeVisible: boolean;
    revealedMarks: number;
  };
  graphHistoryActionLabels: {
    undoBefore: string;
    redoBefore: string;
    resetBefore: string;
    editedNode: string;
    editedField: string;
    undoAfterEdit: string;
    redoAfterEdit: string;
    resetAfterEdit: string;
    journalRows: number;
    journalPressedAfterEdit: string;
    journalSelectionLabel: string;
    journalPressedAfterClick: string;
    undoAfterUndo: string;
    redoAfterUndo: string;
    resetAfterUndo: string;
  };
  graphCodeReveal: {
    selectedBefore: string;
    selectedAfter: string;
    editorView: string;
    revealedMarks: number;
    codeVisible: boolean;
  };
  codeGraphReveal: {
    selectedBefore: string;
    selectedAfter: string;
    editorView: string;
    graphVisible: boolean;
    activeElement: string;
    focusedSelectedNode: boolean;
  };
  errors: string[];
}

const APP_HEALTH_TIMEOUT_MS = 20_000;

export async function runAppHealthRuntimeVerification(
  frame: HTMLIFrameElement,
): Promise<AppHealthRuntimeVerification> {
  const errors: string[] = [];
  const start = performance.now();
  const frameLoad = waitForFrameLoad(frame, APP_HEALTH_TIMEOUT_MS);
  frame.src = `./?app-health-check=${Date.now()}`;
  await frameLoad;
  const health = await waitForAppHealth(frame, APP_HEALTH_TIMEOUT_MS);
  const loadMs = performance.now() - start;
  const dom = summarizeFrameDom(frame);
  const graphHoverStatus = await verifyGraphHoverKeepsStatus(frame, errors);
  const sourceDialogFocus = await verifySourceDialogFocus(frame, errors);
  const sourceHintsShortcutSwitch = await verifySourceHintsShortcutSwitch(frame, errors);
  const prettifyShortcut = await verifyPrettifyShortcut(frame, errors);
  const graphFilterShortcut = await verifyGraphFilterShortcut(frame, errors);
  const selectionFocusButton = await verifySelectionFocusButton(frame, errors);
  const graphHistoryActionLabels = await verifyGraphHistoryActionLabels(frame, errors);
  const graphCodeReveal = await verifyGraphCodeReveal(frame, errors);
  const codeGraphReveal = await verifyCodeGraphReveal(frame, errors);
  const editorModeShortcutSwitch = await verifyEditorModeShortcutSwitch(frame, errors);

  if (!health) {
    errors.push("app health hook never became available");
  } else {
    verifyHealth(health, errors);
  }
  verifyDom(dom, errors);

  return {
    ok: errors.length === 0,
    loadMs,
    health,
    dom,
    graphHoverStatus,
    sourceDialogFocus,
    sourceHintsShortcutSwitch,
    prettifyShortcut,
    graphFilterShortcut,
    editorModeShortcutSwitch,
    selectionFocusButton,
    graphHistoryActionLabels,
    graphCodeReveal,
    codeGraphReveal,
    errors,
  };
}

async function verifyGraphHoverKeepsStatus(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["graphHoverStatus"]> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = { before: "", during: "", after: "" };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for graph hover status verification");
    return empty;
  }

  const graphMode = frameDocument.querySelector<HTMLButtonElement>("#graphModeButton");
  const status = frameDocument.querySelector<HTMLElement>("#editorStatus");
  if (!graphMode || !status) {
    errors.push("app frame missing graph mode button or editor status");
    return empty;
  }

  graphMode.click();
  await nextFrame(frameWindow);

  const graphNodes = Array.from(frameDocument.querySelectorAll<HTMLElement>(".graph-node[data-node-id]"));
  const target = graphNodes.find((node) => node.getAttribute("aria-pressed") !== "true") ?? graphNodes[0] ?? null;
  if (!target) {
    errors.push("app frame had no graph node to hover");
    return empty;
  }

  const before = status.textContent ?? "";
  dispatchPointer(target, "pointerenter");
  dispatchPointer(target, "pointermove");
  await nextFrame(frameWindow);
  const during = status.textContent ?? "";
  dispatchPointer(target, "pointerleave");
  await nextFrame(frameWindow);
  const after = status.textContent ?? "";

  if (during !== before) {
    errors.push(`graph hover changed editor status from "${before}" to "${during}"`);
  }
  if (after !== before) {
    errors.push(`graph hover leave changed editor status from "${before}" to "${after}"`);
  }

  return { before, during, after };
}

async function verifySourceDialogFocus(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["sourceDialogFocus"]> {
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

async function verifySourceHintsShortcutSwitch(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["sourceHintsShortcutSwitch"]> {
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

async function verifyPrettifyShortcut(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["prettifyShortcut"]> {
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

async function verifyGraphFilterShortcut(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["graphFilterShortcut"]> {
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

async function verifySelectionFocusButton(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["selectionFocusButton"]> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = {
    labelBefore: "",
    labelAfterGraph: "",
    labelAfterCode: "",
    shortcut: "",
    shortcutPreventedDefault: false,
    graphView: "",
    graphVisible: false,
    graphFocusedSelectedNode: false,
    codeView: "",
    codeVisible: false,
    revealedMarks: 0,
  };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for selection focus verification");
    return empty;
  }

  const button = frameDocument.querySelector<HTMLButtonElement>("#selectionFocusButton");
  const codeMode = frameDocument.querySelector<HTMLButtonElement>("#codeModeButton");
  const graphPanel = frameDocument.querySelector<HTMLElement>("#graphPanel");
  const codePanel = frameDocument.querySelector<HTMLElement>("#codePanel");
  if (!button || !codeMode || !graphPanel || !codePanel) {
    errors.push("app frame missing selection focus controls");
    return empty;
  }

  codeMode.click();
  await settleFrame(frameWindow);
  const labelBefore = button.textContent?.trim() ?? "";
  const shortcut = button.getAttribute("aria-keyshortcuts") ?? "";
  if (button.hidden) errors.push("selection focus button was hidden before navigation");
  if (!labelBefore.includes("#")) errors.push(`selection focus button label rendered ${labelBefore || "nothing"}`);
  if (shortcut !== "Control+Alt+Enter Meta+Alt+Enter") {
    errors.push(`selection focus button advertised shortcut as ${shortcut || "nothing"}`);
  }

  const KeyboardEventCtor = (frameWindow as AppHealthWindow & { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  const shortcutPreventedDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "Enter",
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  }));
  await settleFrame(frameWindow);
  const graphHealth = readAppHealth(frame);
  const graphView = graphHealth?.editorView ?? "";
  const graphVisible = !graphPanel.classList.contains("hidden");
  const labelAfterGraph = button.textContent?.trim() ?? "";
  const graphFocusedSelectedNode = selectedGraphNodeHasFocus(frameDocument);

  button.click();
  await settleFrame(frameWindow);
  const codeHealth = readAppHealth(frame);
  const codeView = codeHealth?.editorView ?? "";
  const codeVisible = !codePanel.classList.contains("hidden");
  const labelAfterCode = button.textContent?.trim() ?? "";
  const revealedMarks = codeHealth?.sourceRevealedDecorations ?? 0;

  if (graphView !== "graph") errors.push(`selection focus button switched to ${graphView || "unknown"} instead of graph`);
  if (!shortcutPreventedDefault) errors.push("selection focus shortcut did not prevent the browser default");
  if (!graphVisible) errors.push("selection focus button left graph panel hidden");
  if (!graphFocusedSelectedNode) errors.push("selection focus button did not focus the selected graph node");
  if (codeView !== "code") errors.push(`selection focus button returned to ${codeView || "unknown"} instead of code`);
  if (!codeVisible) errors.push("selection focus button left code panel hidden");
  if (revealedMarks < 1) errors.push("selection focus button did not reveal the selected source range");
  if (!labelAfterGraph.includes("#") || !labelAfterCode.includes("#")) {
    errors.push(`selection focus label became ${labelAfterGraph || "nothing"} / ${labelAfterCode || "nothing"}`);
  }

  return {
    labelBefore,
    labelAfterGraph,
    labelAfterCode,
    shortcut,
    shortcutPreventedDefault,
    graphView,
    graphVisible,
    graphFocusedSelectedNode,
    codeView,
    codeVisible,
    revealedMarks,
  };
}

async function verifyGraphHistoryActionLabels(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["graphHistoryActionLabels"]> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = {
    undoBefore: "",
    redoBefore: "",
    resetBefore: "",
    editedNode: "",
    editedField: "",
    undoAfterEdit: "",
    redoAfterEdit: "",
    resetAfterEdit: "",
    journalRows: 0,
    journalPressedAfterEdit: "",
    journalSelectionLabel: "",
    journalPressedAfterClick: "",
    undoAfterUndo: "",
    redoAfterUndo: "",
    resetAfterUndo: "",
  };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for graph history label verification");
    return empty;
  }

  const graphMode = frameDocument.querySelector<HTMLButtonElement>("#graphModeButton");
  const undoButton = frameDocument.querySelector<HTMLButtonElement>("#undoGraphButton");
  if (!graphMode || !undoButton) {
    errors.push("app frame missing graph history label controls");
    return empty;
  }

  graphMode.click();
  await settleFrame(frameWindow);
  const before = readGraphActionLabels(frameDocument);
  const editable = await findEditableGraphNumberInput(frameDocument, frameWindow);
  if (!editable) {
    errors.push("app frame had no editable graph number input for history labels");
    return {
      ...empty,
      undoBefore: before.undo,
      redoBefore: before.redo,
      resetBefore: before.reset,
    };
  }

  const previousValue = Number(editable.input.value);
  const nextValue = Number.isFinite(previousValue) ? Number((previousValue + 0.1).toFixed(4)) : 0.1;
  editable.input.focus();
  editable.input.value = String(nextValue);
  dispatchInput(frameWindow, editable.input);
  await settleFrame(frameWindow);
  const afterEdit = readGraphActionLabels(frameDocument);
  const journalRows = frameDocument.querySelectorAll("#graphChangeJournal .change-entry-row").length;
  const journalEntry = frameDocument.querySelector<HTMLButtonElement>("#graphChangeJournal .change-entry");
  const journalPressedAfterEdit = journalEntry?.getAttribute("aria-pressed") ?? "";
  journalEntry?.click();
  await settleFrame(frameWindow);
  const journalSelectionLabel = readAppHealth(frame)?.selectedSourceLink ?? "";
  const journalPressedAfterClick = frameDocument.querySelector<HTMLButtonElement>("#graphChangeJournal .change-entry")
    ?.getAttribute("aria-pressed") ?? "";

  undoButton.click();
  await settleFrame(frameWindow);
  const afterUndo = readGraphActionLabels(frameDocument);

  if (before.undo !== "Undo graph edit") errors.push(`graph undo label started as ${before.undo || "nothing"}`);
  if (before.redo !== "Redo graph edit") errors.push(`graph redo label started as ${before.redo || "nothing"}`);
  if (before.reset !== "Reset graph edits") errors.push(`graph reset label started as ${before.reset || "nothing"}`);
  if (!afterEdit.undo.startsWith("Undo ") || !afterEdit.undo.includes("#") || !afterEdit.undo.includes("->")) {
    errors.push(`graph undo label after edit was ${afterEdit.undo || "nothing"}`);
  }
  if (afterEdit.redo !== "Redo graph edit") errors.push(`graph redo label after edit was ${afterEdit.redo || "nothing"}`);
  if (afterEdit.reset !== "Reset 1 graph edit") {
    errors.push(`graph reset label after edit was ${afterEdit.reset || "nothing"}`);
  }
  if (journalRows < 1) errors.push("graph change journal did not show the edit");
  if (journalPressedAfterEdit !== "true") {
    errors.push(`graph change journal selected state after edit was ${journalPressedAfterEdit || "nothing"}`);
  }
  if (!journalSelectionLabel || journalSelectionLabel.endsWith(" call")) {
    errors.push(`graph change journal selected ${journalSelectionLabel || "nothing"} instead of the edited parameter`);
  }
  if (journalPressedAfterClick !== "true") {
    errors.push(`graph change journal selected state after click was ${journalPressedAfterClick || "nothing"}`);
  }
  if (afterUndo.undo !== "Undo graph edit") errors.push(`graph undo label after undo was ${afterUndo.undo || "nothing"}`);
  if (!afterUndo.redo.startsWith("Redo ") || !afterUndo.redo.includes("#") || !afterUndo.redo.includes("->")) {
    errors.push(`graph redo label after undo was ${afterUndo.redo || "nothing"}`);
  }
  if (afterUndo.reset !== "Reset graph edits") {
    errors.push(`graph reset label after undo was ${afterUndo.reset || "nothing"}`);
  }

  return {
    undoBefore: before.undo,
    redoBefore: before.redo,
    resetBefore: before.reset,
    editedNode: editable.nodeLabel,
    editedField: editable.fieldLabel,
    undoAfterEdit: afterEdit.undo,
    redoAfterEdit: afterEdit.redo,
    resetAfterEdit: afterEdit.reset,
    journalRows,
    journalPressedAfterEdit,
    journalSelectionLabel,
    journalPressedAfterClick,
    undoAfterUndo: afterUndo.undo,
    redoAfterUndo: afterUndo.redo,
    resetAfterUndo: afterUndo.reset,
  };
}

function readGraphActionLabels(frameDocument: Document): { undo: string; redo: string; reset: string } {
  const undo = frameDocument.querySelector<HTMLButtonElement>("#undoGraphButton")?.getAttribute("aria-label") ?? "";
  const redo = frameDocument.querySelector<HTMLButtonElement>("#redoGraphButton")?.getAttribute("aria-label") ?? "";
  const reset = frameDocument.querySelector<HTMLButtonElement>("#resetGraphButton")?.getAttribute("aria-label") ?? "";
  return { undo, redo, reset };
}

async function findEditableGraphNumberInput(
  frameDocument: Document,
  frameWindow: Window,
): Promise<{ input: HTMLInputElement; nodeLabel: string; fieldLabel: string } | null> {
  const graphNodes = Array.from(frameDocument.querySelectorAll<HTMLElement>(".graph-node[data-node-id]"));
  const preferredNodes = [
    ...graphNodes.filter((node) => /\b(sphere|roundedBox|box|cylinder|torus)\b/i.test(node.textContent ?? "")),
    ...graphNodes,
  ];
  const visited = new Set<HTMLElement>();
  for (const node of preferredNodes) {
    if (visited.has(node)) continue;
    visited.add(node);
    node.click();
    await settleFrame(frameWindow);
    const input = frameDocument.querySelector<HTMLInputElement>("#graphInspector .param-row input[type='number']:not([disabled])");
    if (!input) continue;
    return {
      input,
      nodeLabel: node.textContent?.trim().replace(/\s+/g, " ") ?? "",
      fieldLabel: input.getAttribute("aria-label") ?? "",
    };
  }
  return null;
}

async function verifyEditorModeShortcutSwitch(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["editorModeShortcutSwitch"]> {
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

async function verifyGraphCodeReveal(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["graphCodeReveal"]> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = { selectedBefore: "", selectedAfter: "", editorView: "", revealedMarks: 0, codeVisible: false };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for graph-to-code reveal verification");
    return empty;
  }

  const graphMode = frameDocument.querySelector<HTMLButtonElement>("#graphModeButton");
  const codeMode = frameDocument.querySelector<HTMLButtonElement>("#codeModeButton");
  const codePanel = frameDocument.querySelector<HTMLElement>("#codePanel");
  if (!graphMode || !codeMode || !codePanel) {
    errors.push("app frame missing graph-to-code reveal controls");
    return empty;
  }

  graphMode.click();
  await nextFrame(frameWindow);
  const graphNodes = Array.from(frameDocument.querySelectorAll<HTMLButtonElement>(".graph-node[data-node-id]"));
  const target = graphNodes.find((node) => node.getAttribute("aria-pressed") !== "true") ?? graphNodes[0] ?? null;
  if (!target) {
    errors.push("app frame had no graph node for code reveal");
    return empty;
  }

  target.click();
  await nextFrame(frameWindow);
  const selectedBefore = readAppHealth(frame)?.selectedSourceLink ?? "";
  if (!selectedBefore) {
    errors.push("graph node selection did not produce a selected source link");
  }

  codeMode.click();
  await nextFrame(frameWindow);
  await nextFrame(frameWindow);
  const afterHealth = readAppHealth(frame);
  const selectedAfter = afterHealth?.selectedSourceLink ?? "";
  const editorView = afterHealth?.editorView ?? "";
  const revealedMarks = afterHealth?.sourceRevealedDecorations ?? 0;
  const codeVisible = !codePanel.classList.contains("hidden");

  if (editorView !== "code") errors.push(`graph-to-code reveal left editor in ${editorView || "unknown"} view`);
  if (!codeVisible) errors.push("graph-to-code reveal left code panel hidden");
  if (selectedAfter !== selectedBefore) {
    errors.push(`graph-to-code reveal changed selected link from ${selectedBefore || "nothing"} to ${selectedAfter || "nothing"}`);
  }
  if (revealedMarks < 1) {
    errors.push("graph-to-code reveal did not mark the selected source range");
  }

  return { selectedBefore, selectedAfter, editorView, revealedMarks, codeVisible };
}

async function verifyCodeGraphReveal(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["codeGraphReveal"]> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = {
    selectedBefore: "",
    selectedAfter: "",
    editorView: "",
    graphVisible: false,
    activeElement: "",
    focusedSelectedNode: false,
  };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for code-to-graph reveal verification");
    return empty;
  }

  const graphMode = frameDocument.querySelector<HTMLButtonElement>("#graphModeButton");
  const graphPanel = frameDocument.querySelector<HTMLElement>("#graphPanel");
  if (!graphMode || !graphPanel) {
    errors.push("app frame missing code-to-graph reveal controls");
    return empty;
  }

  const selectedBefore = readAppHealth(frame)?.selectedNode ?? "";
  if (!selectedBefore) {
    errors.push("code-to-graph reveal started without a selected graph node");
  }

  graphMode.click();
  await nextFrame(frameWindow);
  await nextFrame(frameWindow);
  await nextFrame(frameWindow);
  const afterHealth = readAppHealth(frame);
  const selectedAfter = afterHealth?.selectedNode ?? "";
  const editorView = afterHealth?.editorView ?? "";
  const graphVisible = !graphPanel.classList.contains("hidden");
  const activeElement = activeElementToken(frameDocument);
  const focusedSelectedNode = selectedGraphNodeHasFocus(frameDocument);

  if (editorView !== "graph") errors.push(`code-to-graph reveal left editor in ${editorView || "unknown"} view`);
  if (!graphVisible) errors.push("code-to-graph reveal left graph panel hidden");
  if (selectedAfter !== selectedBefore) {
    errors.push(`code-to-graph reveal changed selected node from ${selectedBefore || "nothing"} to ${selectedAfter || "nothing"}`);
  }
  if (!focusedSelectedNode) {
    errors.push(`code-to-graph reveal focused ${activeElement || "nothing"} instead of the selected graph node`);
  }

  return { selectedBefore, selectedAfter, editorView, graphVisible, activeElement, focusedSelectedNode };
}
