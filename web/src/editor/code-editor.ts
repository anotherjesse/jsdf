import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/min/vs/editor/editor.main.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as api from "../api";
import type { GraphSourceLink } from "./clean-source-patch";
import { readSourceLinkNumber, scrubSourceLinkValue } from "./source-link-scrub";

interface MonacoEnvironment {
  getWorker(): Worker;
}

(globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironment }).MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

const SOURCE_HOVER_CLEAR_GRACE_MS = 140;

monaco.languages.registerCompletionItemProvider("javascript", {
  triggerCharacters: ["."],
  provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
    const word = model.getWordUntilPosition(position);
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };
    return {
      suggestions: apiCompletionNames().map((name) => ({
        label: name,
        kind: /^[A-Z0-9_]+$/.test(name)
          ? monaco.languages.CompletionItemKind.Variable
          : monaco.languages.CompletionItemKind.Function,
        insertText: name,
        range,
      })),
    };
  },
});

export interface CodeEditor {
  setValue(value: string): void;
  getValue(): string;
  setError(message: string | null): void;
  setSourceLinks(links: readonly GraphSourceLink[]): void;
  setFocusedNode(nodeId: number | null, options?: { reveal?: boolean }): void;
  markSelectedSourceLink(link: GraphSourceLink | null, options?: { reveal?: boolean }): void;
  markHoveredSourceLink(link: GraphSourceLink | null): void;
  markEditedSourceLink(link: GraphSourceLink | null, options?: { reveal?: boolean }): void;
  revealSourceLink(link: GraphSourceLink): void;
  layout(): void;
  dispose(): void;
}

export function createCodeEditor(
  element: HTMLElement,
  initialValue: string,
  onChange: (value: string) => void,
  onSourceLinkSelect: (link: GraphSourceLink) => void = () => {},
  onSourceLinkValueChange: (link: GraphSourceLink, value: number, options?: SourceLinkValueChangeOptions) => void = () => {},
  onSourceLinkHover: (link: GraphSourceLink | null, options: SourceLinkHoverOptions) => void = () => {},
  onSourceLinkCursor: (link: GraphSourceLink | null) => void = () => {},
): CodeEditor {
  const editor = monaco.editor.create(element, {
    value: initialValue,
    language: "javascript",
    theme: "vs-dark",
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: "on",
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: true,
    renderLineHighlight: "line",
    padding: { top: 10, bottom: 10 },
  });
  const scrubReadout = document.createElement("div");
  scrubReadout.className = "source-scrub-readout";
  scrubReadout.setAttribute("aria-hidden", "true");
  editor.getDomNode()?.append(scrubReadout);

  let suppress = false;
  let sourceLinks: readonly GraphSourceLink[] = [];
  let sourceLinkDecorations: string[] = [];
  let focusedNodeDecorations: string[] = [];
  let revealedSourceDecorations: string[] = [];
  let selectedSourceDecorations: string[] = [];
  let localHoveredSourceDecorations: string[] = [];
  let hoveredSourceDecorations: string[] = [];
  let editedSourceDecorations: string[] = [];
  let focusedNodeId: number | null = null;
  let cursorLinkKey: string | null = null;
  let activeScrub: ActiveSourceScrub | null = null;
  let hoveredKey: string | null = null;
  let hoveredLink: GraphSourceLink | null = null;
  let hoverClearTimer = 0;
  let pointerLink: GraphSourceLink | null = null;
  let shiftDown = false;
  let pointerInside = false;

  const endScrub = () => {
    if (!activeScrub) return;
    activeScrub = null;
    editor.getDomNode()?.classList.remove("source-scrubbing");
    scrubReadout.removeAttribute("data-visible");
    window.removeEventListener("mousemove", scrubMove);
    window.removeEventListener("mouseup", endScrub);
  };

  const scrubMove = (event: MouseEvent) => {
    if (!activeScrub) return;
    const delta = event.clientX - activeScrub.startX;
    if (!activeScrub.dragging && Math.abs(delta) < 2) return;
    activeScrub.dragging = true;
    event.preventDefault();
    editor.getDomNode()?.classList.add("source-scrubbing");
    const nextValue = scrubSourceLinkValue(activeScrub.link, activeScrub.startValue, delta, event);
    if (nextValue === activeScrub.lastValue) return;
    activeScrub.lastValue = nextValue;
    updateScrubReadout(activeScrub.link, nextValue, event);
    onSourceLinkValueChange(activeScrub.link, nextValue, { editSessionId: activeScrub.editSessionId });
  };

  const commitHover = (link: GraphSourceLink | null, shiftKey: boolean) => {
    const key = link ? `${link.nodeId}:${link.label}:${link.start}:${link.end}:${shiftKey}` : null;
    if (key === hoveredKey) return;
    hoveredKey = key;
    hoveredLink = link;
    markLocalHoveredSourceLink(link);
    onSourceLinkHover(link, { shiftKey });
  };

  const clearHoverTimer = () => {
    if (!hoverClearTimer) return;
    window.clearTimeout(hoverClearTimer);
    hoverClearTimer = 0;
  };

  const scheduleHoverClear = () => {
    if (hoverClearTimer) return;
    hoverClearTimer = window.setTimeout(() => {
      hoverClearTimer = 0;
      commitHover(null, false);
    }, SOURCE_HOVER_CLEAR_GRACE_MS);
  };

  const updateScrubReadout = (link: GraphSourceLink, value: number, event: MouseEvent) => {
    const editorBounds = editor.getDomNode()?.getBoundingClientRect();
    if (!editorBounds) return;
    scrubReadout.textContent = `${link.label} ${formatScrubReadoutValue(value)}`;
    scrubReadout.style.left = `${event.clientX - editorBounds.left + 12}px`;
    scrubReadout.style.top = `${event.clientY - editorBounds.top - 28}px`;
    scrubReadout.dataset.visible = "true";
  };

  const updateHover = (
    link: GraphSourceLink | null,
    shiftKey: boolean,
    options: { immediateClear?: boolean } = {},
  ) => {
    if (!link && !options.immediateClear) {
      scheduleHoverClear();
      return;
    }
    clearHoverTimer();
    commitHover(link, shiftKey);
  };

  const linkAtPosition = (position: monaco.Position | null | undefined): GraphSourceLink | null => {
    const model = editor.getModel();
    if (!model || !position) return null;
    const offset = model.getOffsetAt(position);
    const containing = sourceLinks.filter((candidate) => offset >= candidate.start && offset <= candidate.end);
    return containing.sort((a, b) => (a.end - a.start) - (b.end - b.start) || b.start - a.start)[0] ?? null;
  };

  const rangeForSourceLink = (link: GraphSourceLink): monaco.Range | null => {
    const model = editor.getModel();
    if (!model || link.end <= link.start) return null;
    const start = model.getPositionAt(link.start);
    const end = model.getPositionAt(link.end);
    return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
  };

  const sourceLinkKey = (link: GraphSourceLink | null): string | null => {
    return link ? `${link.nodeId}:${link.label}:${link.start}:${link.end}` : null;
  };

  const markSelectedSourceLink = (link: GraphSourceLink | null, options: { reveal?: boolean } = {}) => {
    const range = link ? rangeForSourceLink(link) : null;
    if (!range) {
      selectedSourceDecorations = editor.deltaDecorations(selectedSourceDecorations, []);
      return;
    }
    selectedSourceDecorations = editor.deltaDecorations(selectedSourceDecorations, [{
      range,
      options: {
        inlineClassName: "source-selected-link",
      },
    }]);
    if (options.reveal) {
      editor.revealRangeInCenterIfOutsideViewport(range);
    }
  };

  const updateHoveredSourceDecorations = (decorations: string[], link: GraphSourceLink | null): string[] => {
    const range = link ? rangeForSourceLink(link) : null;
    if (!range) {
      return editor.deltaDecorations(decorations, []);
    }
    return editor.deltaDecorations(decorations, [{
      range,
      options: {
        inlineClassName: "source-hovered-link",
      },
    }]);
  };

  const markLocalHoveredSourceLink = (link: GraphSourceLink | null) => {
    localHoveredSourceDecorations = updateHoveredSourceDecorations(localHoveredSourceDecorations, link);
  };

  const markHoveredSourceLink = (link: GraphSourceLink | null) => {
    hoveredSourceDecorations = updateHoveredSourceDecorations(hoveredSourceDecorations, link);
  };

  const syncCursorSourceLink = (position: monaco.Position | null | undefined) => {
    if (suppress || activeScrub) return;
    const link = linkAtPosition(position);
    const key = sourceLinkKey(link);
    if (key === cursorLinkKey) return;
    cursorLinkKey = key;
    markSelectedSourceLink(link);
    onSourceLinkCursor(link);
  };

  const applyFocusedNodeDecorations = (reveal: boolean) => {
    const model = editor.getModel();
    if (!model || focusedNodeId == null) {
      focusedNodeDecorations = editor.deltaDecorations(focusedNodeDecorations, []);
      return;
    }

    const links = sourceLinks.filter((link) => link.nodeId === focusedNodeId && link.end > link.start);
    focusedNodeDecorations = editor.deltaDecorations(focusedNodeDecorations, links.map((link) => {
      const start = model.getPositionAt(link.start);
      const end = model.getPositionAt(link.end);
      return {
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          inlineClassName: "source-focused-link",
        },
      };
    }));

    if (reveal && links[0]) {
      editor.revealPositionInCenterIfOutsideViewport(model.getPositionAt(links[0].start));
    }
  };

  const subscription = editor.onDidChangeModelContent(() => {
    if (!suppress) onChange(editor.getValue());
  });
  const linkSubscription = editor.onMouseDown((event) => {
    const link = linkAtPosition(event.target.position);
    if (!link) return;
    event.event.preventDefault();
    event.event.stopPropagation();
    cursorLinkKey = sourceLinkKey(link);
    markSelectedSourceLink(link);
    onSourceLinkSelect(link);

    const startValue = isScrubbableSourceLink(link) ? readSourceLinkNumber(editor.getValue(), link) : null;
    if (startValue == null) return;
    activeScrub = {
      link,
      editSessionId: nextEditSessionId("source-scrub"),
      startX: event.event.browserEvent.clientX,
      startValue,
      lastValue: startValue,
      dragging: false,
    };
    window.addEventListener("mousemove", scrubMove);
    window.addEventListener("mouseup", endScrub);
  });
  const hoverSubscription = editor.onMouseMove((event) => {
    if (activeScrub) return;
    pointerInside = true;
    pointerLink = linkAtPosition(event.target.position);
    updateHover(pointerLink, event.event.browserEvent.shiftKey || shiftDown);
  });
  const cursorSubscription = editor.onDidChangeCursorPosition((event) => {
    syncCursorSourceLink(event.position);
  });
  const leaveSubscription = editor.onMouseLeave((event) => {
    pointerInside = false;
    pointerLink = null;
    const shiftKey = event.event.browserEvent.shiftKey || shiftDown;
    if (shiftKey) {
      updateHover(null, true);
      return;
    }
    scheduleHoverClear();
  });
  const keyDownListener = (event: KeyboardEvent) => {
    if (event.key !== "Shift") return;
    shiftDown = true;
    if (hoveredLink) updateHover(hoveredLink, true);
  };
  const keyUpListener = (event: KeyboardEvent) => {
    if (event.key !== "Shift") return;
    shiftDown = false;
    if (pointerInside) {
      updateHover(pointerLink, false);
    } else {
      scheduleHoverClear();
    }
  };
  window.addEventListener("keydown", keyDownListener);
  window.addEventListener("keyup", keyUpListener);

  return {
    setValue(value: string) {
      suppress = true;
      editor.setValue(value);
      suppress = false;
    },
    getValue() {
      return editor.getValue();
    },
    setError(message: string | null) {
      const model = editor.getModel();
      if (!model) return;
      monaco.editor.setModelMarkers(model, "sdf-runtime", message
        ? [{
          severity: monaco.MarkerSeverity.Error,
          message,
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: Math.max(2, model.getLineLength(1) + 1),
        }]
        : []);
    },
    setSourceLinks(links: readonly GraphSourceLink[]) {
      updateHover(null, false, { immediateClear: true });
      pointerLink = null;
      sourceLinks = [...links];
      const model = editor.getModel();
      if (!model) return;
      revealedSourceDecorations = editor.deltaDecorations(revealedSourceDecorations, []);
      selectedSourceDecorations = editor.deltaDecorations(selectedSourceDecorations, []);
      localHoveredSourceDecorations = editor.deltaDecorations(localHoveredSourceDecorations, []);
      hoveredSourceDecorations = editor.deltaDecorations(hoveredSourceDecorations, []);
      editedSourceDecorations = editor.deltaDecorations(editedSourceDecorations, []);
      sourceLinkDecorations = editor.deltaDecorations(sourceLinkDecorations, sourceLinks
        .filter((link) => link.end > link.start)
        .map((link) => {
          const start = model.getPositionAt(link.start);
          const end = model.getPositionAt(link.end);
          const isNumber = isScrubbableSourceLink(link) && readSourceLinkNumber(editor.getValue(), link) != null;
          return {
            range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
            options: {
              inlineClassName: `source-graph-link ${isNumber ? "source-number-link" : "source-node-link"}`,
              hoverMessage: {
                value: sourceLinkHoverMessage(link, isNumber),
              },
            },
          };
        }));
      applyFocusedNodeDecorations(false);
      cursorLinkKey = null;
      syncCursorSourceLink(editor.getPosition());
    },
    setFocusedNode(nodeId: number | null, options: { reveal?: boolean } = {}) {
      focusedNodeId = nodeId;
      applyFocusedNodeDecorations(Boolean(options.reveal));
    },
    markSelectedSourceLink(link: GraphSourceLink | null, options: { reveal?: boolean } = {}) {
      cursorLinkKey = sourceLinkKey(link);
      markSelectedSourceLink(link, options);
    },
    markHoveredSourceLink(link: GraphSourceLink | null) {
      markHoveredSourceLink(link);
    },
    markEditedSourceLink(link: GraphSourceLink | null, options: { reveal?: boolean } = {}) {
      const range = link ? rangeForSourceLink(link) : null;
      if (!range) {
        editedSourceDecorations = editor.deltaDecorations(editedSourceDecorations, []);
        return;
      }
      editedSourceDecorations = editor.deltaDecorations(editedSourceDecorations, [{
        range,
        options: {
          inlineClassName: "source-edited-link",
        },
      }]);
      if (options.reveal) {
        editor.revealRangeInCenterIfOutsideViewport(range);
      }
    },
    revealSourceLink(link: GraphSourceLink) {
      const range = rangeForSourceLink(link);
      if (!range) return;
      revealedSourceDecorations = editor.deltaDecorations(revealedSourceDecorations, [{
        range,
        options: {
          inlineClassName: "source-revealed-link",
        },
      }]);
      editor.setSelection(range);
      editor.revealRangeInCenterIfOutsideViewport(range);
      editor.focus();
    },
    layout() {
      editor.layout();
    },
    dispose() {
      endScrub();
      clearHoverTimer();
      updateHover(null, false, { immediateClear: true });
      window.removeEventListener("keydown", keyDownListener);
      window.removeEventListener("keyup", keyUpListener);
      subscription.dispose();
      linkSubscription.dispose();
      hoverSubscription.dispose();
      cursorSubscription.dispose();
      leaveSubscription.dispose();
      editor.dispose();
    },
  };
}

export interface SourceLinkHoverOptions {
  shiftKey: boolean;
}

export interface SourceLinkValueChangeOptions {
  editSessionId?: string;
}

interface ActiveSourceScrub {
  link: GraphSourceLink;
  editSessionId: string;
  startX: number;
  startValue: number;
  lastValue: number;
  dragging: boolean;
}

function isScrubbableSourceLink(link: GraphSourceLink): boolean {
  return link.scrubbable !== false;
}

function sourceLinkHoverMessage(link: GraphSourceLink, isNumber: boolean): string {
  const target = `${link.nodeKind} #${link.nodeId} ${link.label}`;
  return isNumber
    ? `Graph: ${target}. Drag sideways to tweak; Shift or Alt slows it down.`
    : `Graph: ${target}. Click to inspect it in the graph.`;
}

function formatScrubReadoutValue(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(4)).toString();
}

let nextSourceEditSession = 1;

function nextEditSessionId(prefix: string): string {
  const id = nextSourceEditSession;
  nextSourceEditSession += 1;
  return `${prefix}:${id}`;
}

let completionNames: string[] | null = null;

function apiCompletionNames(): string[] {
  completionNames ??= Object.keys(api).sort();
  return completionNames;
}
