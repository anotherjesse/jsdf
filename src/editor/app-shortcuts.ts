export type AppShortcutEditorView = "code" | "graph";

export const EDITOR_CODE_SHORTCUTS = "Control+Alt+1 Meta+Alt+1";
export const EDITOR_GRAPH_SHORTCUTS = "Control+Alt+2 Meta+Alt+2";
export const GRAPH_FILTER_SHORTCUTS = "Control+F Meta+F /";
export const GRAPH_UNDO_SHORTCUTS = "Control+Z Meta+Z";
export const GRAPH_REDO_SHORTCUTS = "Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y";
export const SOURCE_HINTS_SHORTCUT = "Alt+Shift+H";
export const SOURCE_PRETTIFY_SHORTCUT = "Alt+Shift+F";
export const SELECTED_TARGET_SHORTCUTS = "Control+Alt+Enter Meta+Alt+Enter";

export interface AppKeyboardShortcutActions {
  editorView(): AppShortcutEditorView;
  selectionFocusVisible(): boolean;
  revealSelectedTarget(): void;
  setEditorView(mode: AppShortcutEditorView): void;
  focusGraphFilter(): void;
  sourceHintsAvailable(): boolean;
  toggleSourceHints(): void;
  prettifySource(): void;
  openSourceDialog(): void;
  saveSource(): void;
  canUndoGraph(): boolean;
  canRedoGraph(): boolean;
  undoGraphEdit(): void;
  redoGraphEdit(): void;
}

export function configureEditorModeShortcutButtons(codeButton: HTMLButtonElement, graphButton: HTMLButtonElement): void {
  codeButton.title = "Code (Cmd/Ctrl+Alt+1)";
  codeButton.setAttribute("aria-keyshortcuts", EDITOR_CODE_SHORTCUTS);
  graphButton.title = "Graph (Cmd/Ctrl+Alt+2)";
  graphButton.setAttribute("aria-keyshortcuts", EDITOR_GRAPH_SHORTCUTS);
}

export function configureGraphHistoryShortcutButtons(undoButton: HTMLButtonElement, redoButton: HTMLButtonElement): void {
  undoButton.setAttribute("aria-keyshortcuts", GRAPH_UNDO_SHORTCUTS);
  redoButton.setAttribute("aria-keyshortcuts", GRAPH_REDO_SHORTCUTS);
}

export function installAppKeyboardShortcuts(target: Window, actions: AppKeyboardShortcutActions): () => void {
  const appShortcutHandler = (event: KeyboardEvent) => handleAppKeyboardShortcut(event, actions);
  const graphShortcutHandler = (event: KeyboardEvent) => handleGraphKeyboardShortcut(event, actions);

  target.addEventListener("keydown", appShortcutHandler, { capture: true });
  target.addEventListener("keydown", graphShortcutHandler);

  return () => {
    target.removeEventListener("keydown", appShortcutHandler, true);
    target.removeEventListener("keydown", graphShortcutHandler);
  };
}

function handleAppKeyboardShortcut(event: KeyboardEvent, actions: AppKeyboardShortcutActions): void {
  if (isSelectedTargetShortcut(event) && actions.selectionFocusVisible()) {
    event.preventDefault();
    if (!event.repeat) actions.revealSelectedTarget();
    return;
  }

  const editorShortcutMode = editorModeShortcut(event);
  if (editorShortcutMode) {
    event.preventDefault();
    if (!event.repeat) actions.setEditorView(editorShortcutMode);
    return;
  }

  if (actions.editorView() === "graph" && isGraphFilterShortcut(event) && !isEditableEventTarget(event.target)) {
    event.preventDefault();
    if (!event.repeat) actions.focusGraphFilter();
    return;
  }

  if (isSourceHintsShortcut(event)) {
    if (!actions.sourceHintsAvailable()) return;
    event.preventDefault();
    if (!event.repeat) actions.toggleSourceHints();
    return;
  }

  if (isPrettifyShortcut(event) && !isEditableEventTarget(event.target)) {
    event.preventDefault();
    if (!event.repeat) actions.prettifySource();
    return;
  }

  if (isLoadShortcut(event)) {
    event.preventDefault();
    if (!event.repeat) actions.openSourceDialog();
    return;
  }

  if (!isSaveShortcut(event)) return;
  event.preventDefault();
  if (!event.repeat) actions.saveSource();
}

function handleGraphKeyboardShortcut(event: KeyboardEvent, actions: AppKeyboardShortcutActions): void {
  if (actions.editorView() !== "graph") return;
  if (!event.metaKey && !event.ctrlKey) return;
  if (event.altKey || isEditableEventTarget(event.target)) return;

  const key = event.key.toLowerCase();
  if (key === "z" && event.shiftKey) {
    if (!actions.canRedoGraph()) return;
    event.preventDefault();
    actions.redoGraphEdit();
    return;
  }

  if (key === "z") {
    if (!actions.canUndoGraph()) return;
    event.preventDefault();
    actions.undoGraphEdit();
    return;
  }

  if (key === "y") {
    if (!actions.canRedoGraph()) return;
    event.preventDefault();
    actions.redoGraphEdit();
  }
}

function isLoadShortcut(event: KeyboardEvent): boolean {
  return isCommandShortcut(event, "o");
}

function isSaveShortcut(event: KeyboardEvent): boolean {
  return isCommandShortcut(event, "s");
}

function isGraphFilterShortcut(event: KeyboardEvent): boolean {
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "/") {
    return true;
  }
  return isCommandShortcut(event, "f");
}

function editorModeShortcut(event: KeyboardEvent): AppShortcutEditorView | null {
  if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === "1") return "code";
  if (key === "2") return "graph";
  return null;
}

function isSourceHintsShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || !event.altKey || !event.shiftKey) return false;
  return event.code === "KeyH" || event.key.toLowerCase() === "h";
}

function isPrettifyShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || !event.altKey || !event.shiftKey) return false;
  return event.code === "KeyF" || event.key.toLowerCase() === "f";
}

function isSelectedTargetShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey)
    && event.altKey
    && !event.shiftKey
    && event.key === "Enter";
}

function isCommandShortcut(event: KeyboardEvent, key: string): boolean {
  return (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === key;
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
