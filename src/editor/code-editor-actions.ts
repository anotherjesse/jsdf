import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import type { ScrubModifiers } from "./scrub-values";

export interface CodeEditorActionCallbacks {
  onPrettify(): void;
  onQuickFix(): void;
  onSelectAdjacentSourceLink(direction: -1 | 1): void;
  onRevealSourceLinkInGraph(): void;
  onNudgeSourceLink(direction: -1 | 1, modifiers: ScrubModifiers): boolean;
}

export interface CodeEditorActions {
  dispose(): void;
}

export function installCodeEditorActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  callbacks: CodeEditorActionCallbacks,
): CodeEditorActions {
  const disposables: Array<{ dispose(): void }> = [];
  disposables.push(editor.onKeyDown((event) => {
    const browserEvent = event.browserEvent;
    const direction = sourceNudgeDirectionForKey(browserEvent.key);
    if (!direction || !browserEvent.altKey || browserEvent.metaKey || browserEvent.ctrlKey) return;
    if (!callbacks.onNudgeSourceLink(direction, { altKey: browserEvent.shiftKey, shiftKey: false })) return;
    event.preventDefault();
    event.stopPropagation();
  }));
  disposables.push(editor.addAction({
    id: "sdf.prettifySource",
    label: "Prettify SDF Source",
    keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
    contextMenuGroupId: "sdf",
    contextMenuOrder: 1,
    run() {
      callbacks.onPrettify();
    },
  }));
  disposables.push(editor.addAction({
    id: "sdf.applyPreferredQuickFix",
    label: "Apply SDF Quick Fix",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period],
    contextMenuGroupId: "sdf",
    contextMenuOrder: 0,
    run() {
      callbacks.onQuickFix();
    },
  }));
  disposables.push(editor.addAction({
    id: "sdf.nextSourceLink",
    label: "Next SDF Source Link",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow],
    contextMenuGroupId: "sdf",
    contextMenuOrder: 2,
    run() {
      callbacks.onSelectAdjacentSourceLink(1);
    },
  }));
  disposables.push(editor.addAction({
    id: "sdf.previousSourceLink",
    label: "Previous SDF Source Link",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow],
    contextMenuGroupId: "sdf",
    contextMenuOrder: 3,
    run() {
      callbacks.onSelectAdjacentSourceLink(-1);
    },
  }));
  disposables.push(editor.addAction({
    id: "sdf.revealSourceLinkInGraph",
    label: "Reveal SDF Source Link in Graph",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Enter],
    contextMenuGroupId: "sdf",
    contextMenuOrder: 4,
    run() {
      callbacks.onRevealSourceLinkInGraph();
    },
  }));

  return {
    dispose() {
      for (const disposable of disposables) disposable.dispose();
    },
  };
}

function sourceNudgeDirectionForKey(key: string): -1 | 1 | null {
  if (key === "ArrowDown") return -1;
  if (key === "ArrowUp") return 1;
  return null;
}
