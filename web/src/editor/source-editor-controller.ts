import { SOURCE_HINTS_SHORTCUT } from "./app-shortcuts";
import type { CodeEditor } from "./code-editor";
import { prettifySource } from "./prettify-source";
import type { EditorPreferences } from "./editor-preferences";

export type EditorStatusState = "idle" | "ok" | "pending" | "error";

export interface SourceCompileOptions {
  status: string;
  statusState?: EditorStatusState;
  invalidateMesh?: boolean;
}

export interface SourceEditorElements {
  prettifyButton: HTMLButtonElement;
  sourceHintsButton: HTMLButtonElement;
}

export interface SourceEditorControllerOptions {
  elements: SourceEditorElements;
  initialGraphHintsEnabled: boolean;
  codeEditor(): CodeEditor | null;
  sourceValid(): boolean;
  preserveHiddenNodeKeys(): void;
  clearSourceLinks(): void;
  updateSaveState(): void;
  compileSource(options?: SourceCompileOptions): boolean;
  setEditorStatus(message: string, state: EditorStatusState): void;
  savePreferences(preferences: EditorPreferences): void;
}

export interface SourceEditorController {
  readonly graphHintsEnabled: boolean;
  readonly sourceCompilePending: boolean;
  applyGraphHintsToEditor(): void;
  setGraphHintsEnabled(enabled: boolean): void;
  toggleGraphHints(): void;
  prettifyCurrentSource(): void;
  scheduleCompile(): void;
  clearPendingCompile(): void;
  flushPendingCompile(): boolean;
  currentSourceCompilesForSave(): boolean;
}

export function createSourceEditorController(options: SourceEditorControllerOptions): SourceEditorController {
  let graphHintsEnabled = options.initialGraphHintsEnabled;
  let sourceCompileTimer = 0;

  options.elements.prettifyButton.addEventListener("click", prettifyCurrentSource);
  options.elements.sourceHintsButton.addEventListener("click", toggleGraphHints);
  updateSourceHintsButton();

  function applyGraphHintsToEditor(): void {
    options.codeEditor()?.setGraphHintsEnabled(graphHintsEnabled);
  }

  function setGraphHintsEnabled(enabled: boolean): void {
    graphHintsEnabled = enabled;
    applyGraphHintsToEditor();
    updateSourceHintsButton();
    options.savePreferences({ graphHintsEnabled });
  }

  function toggleGraphHints(): void {
    setGraphHintsEnabled(!graphHintsEnabled);
    options.setEditorStatus(graphHintsEnabled ? "Graph hints shown" : "Graph hints hidden", "idle");
  }

  function updateSourceHintsButton(): void {
    const { sourceHintsButton } = options.elements;
    sourceHintsButton.setAttribute("aria-pressed", String(graphHintsEnabled));
    sourceHintsButton.setAttribute("aria-keyshortcuts", SOURCE_HINTS_SHORTCUT);
    sourceHintsButton.title = `${graphHintsEnabled ? "Hide" : "Show"} graph hints (${SOURCE_HINTS_SHORTCUT})`;
  }

  function currentSourceCompilesForSave(): boolean {
    if (sourceCompileTimer) return flushPendingCompile();
    if (options.sourceValid()) return true;
    options.setEditorStatus("Fix code before saving", "error");
    return false;
  }

  function prettifyCurrentSource(): void {
    const codeEditor = options.codeEditor();
    if (!codeEditor) return;
    const source = codeEditor.getValue();
    const nextSource = prettifySource(source);
    if (nextSource === source) {
      options.setEditorStatus("Already pretty", "idle");
      return;
    }
    clearPendingCompile();
    options.preserveHiddenNodeKeys();
    codeEditor.setValue(nextSource);
    options.updateSaveState();
    options.compileSource({ status: "Prettified" });
  }

  function scheduleCompile(): void {
    clearPendingCompile();
    options.preserveHiddenNodeKeys();
    options.updateSaveState();
    options.setEditorStatus("Editing...", "pending");
    options.clearSourceLinks();
    sourceCompileTimer = window.setTimeout(() => {
      sourceCompileTimer = 0;
      options.compileSource({ status: "Compiled" });
    }, 350);
  }

  function clearPendingCompile(): void {
    if (!sourceCompileTimer) return;
    window.clearTimeout(sourceCompileTimer);
    sourceCompileTimer = 0;
  }

  function flushPendingCompile(): boolean {
    if (!sourceCompileTimer) return options.sourceValid();
    clearPendingCompile();
    return options.compileSource({ status: "Compiled" });
  }

  return {
    get graphHintsEnabled() {
      return graphHintsEnabled;
    },
    get sourceCompilePending() {
      return Boolean(sourceCompileTimer);
    },
    applyGraphHintsToEditor,
    setGraphHintsEnabled,
    toggleGraphHints,
    prettifyCurrentSource,
    scheduleCompile,
    clearPendingCompile,
    flushPendingCompile,
    currentSourceCompilesForSave,
  };
}
