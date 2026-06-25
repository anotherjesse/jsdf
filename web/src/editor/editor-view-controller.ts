import type { Node } from "../core/nodes";
import { configureEditorModeShortcutButtons, SELECTED_TARGET_SHORTCUTS, type AppShortcutEditorView } from "./app-shortcuts";
import type { GraphSourceLink } from "./clean-source-patch";
import type { CodeEditor } from "./code-editor";
import type { GraphInspector } from "./graph-inspector";

export type EditorView = AppShortcutEditorView;

export interface EditorViewElements {
  codeModeButton: HTMLButtonElement;
  graphModeButton: HTMLButtonElement;
  selectionFocusButton: HTMLButtonElement;
  codePanel: HTMLElement;
  graphPanel: HTMLElement;
}

export interface EditorViewSelectedTarget {
  label: string;
  sourceLink: GraphSourceLink | null;
  graphNode: Node | null;
}

export interface EditorViewControllerOptions {
  elements: EditorViewElements;
  codeEditor(): CodeEditor | null;
  graphInspector(): GraphInspector | null;
  readSelectedTarget(): EditorViewSelectedTarget;
  flushPendingSourceCompile(): boolean;
  afterBrowserFrame(callback: () => void): void;
  revealGraphSource(link: GraphSourceLink): void;
  revealSourceLinkInGraph(link: GraphSourceLink): void;
}

export interface EditorViewController {
  readonly view: EditorView;
  setView(mode: EditorView): void;
  revealSelectedTarget(): void;
  updateSelectionFocusButton(): void;
  selectionFocusVisible(): boolean;
}

export function createEditorViewController(options: EditorViewControllerOptions): EditorViewController {
  const { elements } = options;
  let view: EditorView = "code";

  configureEditorModeShortcutButtons(elements.codeModeButton, elements.graphModeButton);
  elements.codeModeButton.addEventListener("click", () => setView("code"));
  elements.graphModeButton.addEventListener("click", () => setView("graph"));
  elements.selectionFocusButton.addEventListener("click", revealSelectedTarget);
  updateSelectionFocusButton();

  function setView(mode: EditorView): void {
    const previousMode = view;
    if (mode === "graph" && previousMode === "code" && !options.flushPendingSourceCompile()) {
      return;
    }

    view = mode;
    elements.codeModeButton.setAttribute("aria-pressed", String(mode === "code"));
    elements.graphModeButton.setAttribute("aria-pressed", String(mode === "graph"));
    elements.codePanel.classList.toggle("hidden", mode !== "code");
    elements.graphPanel.classList.toggle("hidden", mode !== "graph");
    updateSelectionFocusButton();
    if (view === "code") {
      options.afterBrowserFrame(() => {
        options.codeEditor()?.layout();
        const { sourceLink } = options.readSelectedTarget();
        if (previousMode === "graph" && sourceLink) {
          options.codeEditor()?.revealSourceLink(sourceLink);
        }
      });
      return;
    }

    if (previousMode === "code") {
      options.codeEditor()?.blur();
      options.afterBrowserFrame(() => {
        options.graphInspector()?.revealSelected({ focus: true });
      });
    }
  }

  function revealSelectedTarget(): void {
    const target = options.readSelectedTarget();
    if (view === "graph") {
      if (target.sourceLink) options.revealGraphSource(target.sourceLink);
      else setView("code");
      return;
    }

    if (target.sourceLink) {
      options.revealSourceLinkInGraph(target.sourceLink);
      return;
    }

    if (target.graphNode) {
      setView("graph");
      options.afterBrowserFrame(() => options.graphInspector()?.revealSelected({ focus: true }));
    }
  }

  function updateSelectionFocusButton(): void {
    const { label } = options.readSelectedTarget();
    if (!label) {
      elements.selectionFocusButton.hidden = true;
      elements.selectionFocusButton.textContent = "";
      elements.selectionFocusButton.removeAttribute("title");
      elements.selectionFocusButton.removeAttribute("aria-label");
      elements.selectionFocusButton.removeAttribute("aria-keyshortcuts");
      return;
    }

    const destination = view === "graph" ? "code" : "graph";
    elements.selectionFocusButton.hidden = false;
    elements.selectionFocusButton.textContent = label;
    elements.selectionFocusButton.title = `Reveal ${label} in ${destination} (Cmd/Ctrl+Alt+Enter)`;
    elements.selectionFocusButton.setAttribute("aria-label", `Reveal ${label} in ${destination}`);
    elements.selectionFocusButton.setAttribute("aria-keyshortcuts", SELECTED_TARGET_SHORTCUTS);
  }

  function selectionFocusVisible(): boolean {
    return !elements.selectionFocusButton.hidden;
  }

  return {
    get view() {
      return view;
    },
    setView,
    revealSelectedTarget,
    updateSelectionFocusButton,
    selectionFocusVisible,
  };
}
