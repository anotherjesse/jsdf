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
  revealSourceLink(link: GraphSourceLink): void;
  layout(): void;
  dispose(): void;
}

export function createCodeEditor(
  element: HTMLElement,
  initialValue: string,
  onChange: (value: string) => void,
  onSourceLinkSelect: (link: GraphSourceLink) => void = () => {},
  onSourceLinkValueChange: (link: GraphSourceLink, value: number) => void = () => {},
  onSourceLinkHover: (link: GraphSourceLink | null, options: SourceLinkHoverOptions) => void = () => {},
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

  let suppress = false;
  let sourceLinks: readonly GraphSourceLink[] = [];
  let sourceLinkDecorations: string[] = [];
  let focusedNodeDecorations: string[] = [];
  let revealedSourceDecorations: string[] = [];
  let focusedNodeId: number | null = null;
  let activeScrub: ActiveSourceScrub | null = null;
  let hoveredKey: string | null = null;
  let hoveredLink: GraphSourceLink | null = null;

  const endScrub = () => {
    if (!activeScrub) return;
    activeScrub = null;
    editor.getDomNode()?.classList.remove("source-scrubbing");
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
    onSourceLinkValueChange(activeScrub.link, nextValue);
  };

  const updateHover = (link: GraphSourceLink | null, shiftKey: boolean) => {
    const key = link ? `${link.nodeId}:${link.label}:${link.start}:${link.end}:${shiftKey}` : null;
    if (key === hoveredKey) return;
    hoveredKey = key;
    hoveredLink = link;
    onSourceLinkHover(link, { shiftKey });
  };

  const linkAtPosition = (position: monaco.Position | null | undefined): GraphSourceLink | null => {
    const model = editor.getModel();
    if (!model || !position) return null;
    const offset = model.getOffsetAt(position);
    return sourceLinks.find((candidate) => offset >= candidate.start && offset <= candidate.end) ?? null;
  };

  const rangeForSourceLink = (link: GraphSourceLink): monaco.Range | null => {
    const model = editor.getModel();
    if (!model || link.end <= link.start) return null;
    const start = model.getPositionAt(link.start);
    const end = model.getPositionAt(link.end);
    return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
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
    onSourceLinkSelect(link);

    const startValue = isScrubbableSourceLink(link) ? readSourceLinkNumber(editor.getValue(), link) : null;
    if (startValue == null) return;
    activeScrub = {
      link,
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
    updateHover(linkAtPosition(event.target.position), event.event.browserEvent.shiftKey);
  });
  const leaveSubscription = editor.onMouseLeave(() => updateHover(null, false));
  const keyDownListener = (event: KeyboardEvent) => {
    if (event.key === "Shift" && hoveredLink) updateHover(hoveredLink, true);
  };
  const keyUpListener = (event: KeyboardEvent) => {
    if (event.key === "Shift" && hoveredLink) updateHover(hoveredLink, false);
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
      updateHover(null, false);
      sourceLinks = [...links];
      const model = editor.getModel();
      if (!model) return;
      revealedSourceDecorations = editor.deltaDecorations(revealedSourceDecorations, []);
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
                value: `Graph: ${link.nodeKind} #${link.nodeId} ${link.label}`,
              },
            },
          };
        }));
      applyFocusedNodeDecorations(false);
    },
    setFocusedNode(nodeId: number | null, options: { reveal?: boolean } = {}) {
      focusedNodeId = nodeId;
      applyFocusedNodeDecorations(Boolean(options.reveal));
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
      updateHover(null, false);
      window.removeEventListener("keydown", keyDownListener);
      window.removeEventListener("keyup", keyUpListener);
      subscription.dispose();
      linkSubscription.dispose();
      hoverSubscription.dispose();
      leaveSubscription.dispose();
      editor.dispose();
    },
  };
}

export interface SourceLinkHoverOptions {
  shiftKey: boolean;
}

interface ActiveSourceScrub {
  link: GraphSourceLink;
  startX: number;
  startValue: number;
  lastValue: number;
  dragging: boolean;
}

function isScrubbableSourceLink(link: GraphSourceLink): boolean {
  return link.scrubbable !== false;
}

let completionNames: string[] | null = null;

function apiCompletionNames(): string[] {
  completionNames ??= Object.keys(api).sort();
  return completionNames;
}
