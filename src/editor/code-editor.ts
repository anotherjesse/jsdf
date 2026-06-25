import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/min/vs/editor/editor.main.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import type { GraphSourceLink } from "./clean-source-patch";
import { installCodeEditorActions } from "./code-editor-actions";
import {
  clearSourceLinkDecorations,
  rangeForSourceLink,
  sourceLinkKey,
  updateFocusedSourceLinkDecorations,
  updateGraphSourceLinkDecorations,
  updateSourceLinkDecoration,
} from "./code-editor-source-decorations";
import {
  applyPreferredQuickFix as applyEditorPreferredQuickFix,
  runtimeDiagnosticCount as editorRuntimeDiagnosticCount,
  setEditorRuntimeError,
  type CodeEditorError,
} from "./source-editor-markers";
import {
  clearSourceInlayHintState as clearSourceInlayHintStateForModel,
  deleteSourceInlayHintState as deleteSourceInlayHintStateForModel,
  refreshSourceInlayHints,
  setSourceInlayHintState,
} from "./source-language-features";
import { sourceLinkAtOffset, stickySourceLinkAtOffset } from "./source-link-hit-test";
import { sourcePathsEqual } from "./source-link-matching";
import { adjacentSourceLink, navigableSourceLinks, sourceLinkNavigationKey } from "./source-link-navigation";
import { nudgeSourceLinkValue, readSourceLinkNumber, scrubSourceLinkValue } from "./source-link-scrub";
import { SourceLinkStatusBar } from "./source-link-status-bar";
import { SourceScrubReadout } from "./source-scrub-readout";
import type { ScrubModifiers } from "./scrub-values";

export { sourceLinkHoverMessage, sourceLinkStatusText } from "./source-link-status-bar";

interface MonacoEnvironment {
  getWorker(): Worker;
}

(globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironment }).MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

const SOURCE_HOVER_CLEAR_GRACE_MS = 140;
const SOURCE_HOVER_STICKY_COLUMNS = 2;

export interface CodeEditor {
  setValue(value: string): void;
  getValue(): string;
  setError(error: CodeEditorError | null): void;
  runtimeDiagnosticCount(): number;
  setSourceLinks(links: readonly GraphSourceLink[]): void;
  setGraphHintsEnabled(enabled: boolean): void;
  setFocusedNode(nodeId: number | null, options?: { reveal?: boolean }): void;
  markSelectedSourceLink(link: GraphSourceLink | null, options?: { reveal?: boolean }): void;
  markHoveredSourceLink(link: GraphSourceLink | null): void;
  markEditedSourceLink(link: GraphSourceLink | null, options?: { reveal?: boolean }): void;
  revealSourceLink(link: GraphSourceLink): void;
  applyPreferredQuickFix(): boolean;
  selectAdjacentSourceLink(direction: -1 | 1): boolean;
  revealCurrentSourceLinkInGraph(): boolean;
  nudgeCurrentSourceLink(direction: -1 | 1, modifiers?: ScrubModifiers, options?: { editSessionId?: string }): boolean;
  sourceDecorationCount(kind: "hovered" | "edited" | "selected" | "revealed"): number;
  blur(): void;
  layout(): void;
  dispose(): void;
}

export interface SourceLinkSelectOptions {
  revealGraph?: boolean;
}

export function createCodeEditor(
  element: HTMLElement,
  initialValue: string,
  onChange: (value: string) => void,
  onSourceLinkSelect: (link: GraphSourceLink, options?: SourceLinkSelectOptions) => void = () => {},
  onSourceLinkValueChange: (link: GraphSourceLink, value: number, options?: SourceLinkValueChangeOptions) => void = () => {},
  onSourceLinkHover: (link: GraphSourceLink | null, options: SourceLinkHoverOptions) => void = () => {},
  onSourceLinkCursor: (link: GraphSourceLink | null) => void = () => {},
  onPrettify: () => void = () => {},
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
    quickSuggestions: {
      other: true,
      comments: false,
      strings: false,
    },
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: "smart",
    wordBasedSuggestions: "off",
    snippetSuggestions: "top",
    inlayHints: {
      enabled: "on",
      padding: true,
      maximumLength: 18,
    },
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: true,
    renderLineHighlight: "line",
    padding: { top: 10, bottom: 10 },
  });
  const scrubReadout = new SourceScrubReadout();
  const sourceLinkStatusBar = new SourceLinkStatusBar({
    onNavigate(direction) {
      selectAdjacentSourceLink(direction);
    },
    onNudge(direction, modifiers) {
      nudgeStatusSourceLink(direction, modifiers);
    },
    onReveal() {
      const link = liveSourceLinkFor(selectedSourceLink);
      if (!link) return;
      selectSourceLink(link, { reveal: true, selectRange: true, revealGraph: true });
    },
  });
  editor.getDomNode()?.append(scrubReadout.element, sourceLinkStatusBar.element);

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
  let selectedSourceLink: GraphSourceLink | null = null;
  let keyboardNudgeSessionId: string | null = null;
  let keyboardNudgeLinkKey: string | null = null;
  let keyboardNudgeClearTimer = 0;
  let hoverClearTimer = 0;
  let cursorSyncFrame = 0;
  let cursorSyncFallbackTimer = 0;
  let pendingCursorPosition: monaco.Position | null = null;
  let pointerLink: GraphSourceLink | null = null;
  let shiftDown = false;
  let pointerInside = false;

  const endScrub = () => {
    if (!activeScrub) return;
    activeScrub = null;
    editor.getDomNode()?.classList.remove("source-scrubbing");
    scrubReadout.hide();
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
    updatePointerScrubReadout(activeScrub.link, nextValue, event);
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

  const updatePointerScrubReadout = (link: GraphSourceLink, value: number, event: MouseEvent) => {
    scrubReadout.showPointer(link, value, event, editor.getDomNode());
  };

  const updateKeyboardNudgeReadout = (link: GraphSourceLink, value: number) => {
    const domNode = editor.getDomNode();
    const range = rangeForSourceLink(editor, link);
    if (!domNode || !range) return;
    const visiblePosition = editor.getScrolledVisiblePosition({
      lineNumber: range.startLineNumber,
      column: range.startColumn,
    });
    if (!visiblePosition) return;
    scrubReadout.showKeyboard(link, value, visiblePosition, domNode, () => activeScrub != null);
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

  const linkAtPosition = (
    position: monaco.Position | null | undefined,
    options: { sticky?: boolean } = {},
  ): GraphSourceLink | null => {
    const model = editor.getModel();
    if (!model || !position) return null;
    const offset = model.getOffsetAt(position);
    if (!options.sticky) return sourceLinkAtOffset(sourceLinks, offset);
    return stickySourceLinkAtOffset(sourceLinks, offset, (sourceOffset) => {
      return model.getPositionAt(sourceOffset).lineNumber;
    }, {
      stickyColumns: SOURCE_HOVER_STICKY_COLUMNS,
      preferredNodeId: hoveredLink?.nodeId ?? null,
    });
  };

  const selectedLinkAtPosition = (position: monaco.Position | null | undefined): GraphSourceLink | null => {
    const model = editor.getModel();
    if (!model || !position || !selectedSourceLink || selectedSourceLink.end <= selectedSourceLink.start) return null;
    const offset = model.getOffsetAt(position);
    return offset >= selectedSourceLink.start && offset <= selectedSourceLink.end ? selectedSourceLink : null;
  };

  const markSelectedSourceLink = (link: GraphSourceLink | null, options: { reveal?: boolean } = {}) => {
    selectedSourceLink = link;
    updateSourceLinkStatus(link);
    const range = link ? rangeForSourceLink(editor, link) : null;
    selectedSourceDecorations = updateSourceLinkDecoration(editor, selectedSourceDecorations, link, "selected");
    if (options.reveal && range) {
      editor.revealRangeInCenterIfOutsideViewport(range);
    }
  };

  const selectSourceLinkFromInlayHint = (link: GraphSourceLink) => {
    cursorLinkKey = sourceLinkKey(link);
    markSelectedSourceLink(link);
    onSourceLinkSelect(link);
    editor.focus();
  };

  const updateSourceInlayHintState = (links: readonly GraphSourceLink[]) => {
    const model = editor.getModel();
    if (!model) return;
    setSourceInlayHintState(model, links, selectSourceLinkFromInlayHint);
  };

  const clearSourceInlayHintState = () => {
    const model = editor.getModel();
    if (!model) return;
    clearSourceInlayHintStateForModel(model, selectSourceLinkFromInlayHint);
  };

  const deleteSourceInlayHintState = () => {
    const model = editor.getModel();
    if (!model) return;
    deleteSourceInlayHintStateForModel(model);
  };

  const markLocalHoveredSourceLink = (link: GraphSourceLink | null) => {
    localHoveredSourceDecorations = updateSourceLinkDecoration(editor, localHoveredSourceDecorations, link, "hovered");
  };

  const markHoveredSourceLink = (link: GraphSourceLink | null) => {
    hoveredSourceDecorations = updateSourceLinkDecoration(editor, hoveredSourceDecorations, link, "hovered");
  };

  const syncCursorSourceLink = (position: monaco.Position | null | undefined) => {
    if (suppress || activeScrub) return;
    const link = linkAtPosition(position) ?? selectedLinkAtPosition(position);
    const key = sourceLinkKey(link);
    if (key === cursorLinkKey) return;
    cursorLinkKey = key;
    markSelectedSourceLink(link);
    onSourceLinkCursor(link);
  };

  const liveSourceLinkFor = (candidate: GraphSourceLink | null): GraphSourceLink | null => {
    if (!candidate) return null;
    const exact = sourceLinks.find((link) => sourceLinkKey(link) === sourceLinkKey(candidate));
    if (exact) return exact;
    return sourceLinks.find((link) => {
      return link.nodeId === candidate.nodeId
        && link.label === candidate.label
        && sourcePathsEqual(link.path, candidate.path)
        && link.end > link.start;
    }) ?? null;
  };

  const currentSourceLinkForNudge = (): GraphSourceLink | null => {
    return liveSourceLinkFor(linkAtPosition(editor.getPosition(), { sticky: true }))
      ?? liveSourceLinkFor(selectedSourceLink)
      ?? liveSourceLinkFor(hoveredLink);
  };

  const clearKeyboardNudgeSession = () => {
    if (keyboardNudgeClearTimer) {
      window.clearTimeout(keyboardNudgeClearTimer);
      keyboardNudgeClearTimer = 0;
    }
    keyboardNudgeSessionId = null;
    keyboardNudgeLinkKey = null;
  };

  const keyboardNudgeSessionFor = (link: GraphSourceLink): string => {
    const key = sourceLinkKey(link);
    if (!keyboardNudgeSessionId || keyboardNudgeLinkKey !== key) {
      keyboardNudgeSessionId = nextEditSessionId("source-key-nudge");
      keyboardNudgeLinkKey = key;
    }
    if (keyboardNudgeClearTimer) window.clearTimeout(keyboardNudgeClearTimer);
    keyboardNudgeClearTimer = window.setTimeout(clearKeyboardNudgeSession, 450);
    return keyboardNudgeSessionId;
  };

  const nudgeCurrentSourceLink = (
    direction: -1 | 1,
    modifiers: ScrubModifiers = { altKey: false, shiftKey: false },
    options: { editSessionId?: string } = {},
  ): boolean => {
    const link = currentSourceLinkForNudge();
    if (!link) return false;
    return nudgeSourceLink(link, direction, modifiers, {
      editSessionId: options.editSessionId ?? keyboardNudgeSessionFor(link),
    });
  };

  const nudgeSourceLink = (
    link: GraphSourceLink,
    direction: -1 | 1,
    modifiers: ScrubModifiers,
    options: { editSessionId?: string } = {},
  ): boolean => {
    if (!link || !isScrubbableSourceLink(link)) return false;
    const startValue = readSourceLinkNumber(editor.getValue(), link);
    if (startValue == null) return false;
    const nextValue = nudgeSourceLinkValue(link, startValue, direction, modifiers);
    if (nextValue === startValue) return false;
    cursorLinkKey = sourceLinkKey(link);
    markSelectedSourceLink(link);
    updateKeyboardNudgeReadout(link, nextValue);
    onSourceLinkSelect(link);
    onSourceLinkValueChange(link, nextValue, {
      ...(options.editSessionId ? { editSessionId: options.editSessionId } : {}),
    });
    updateSourceLinkStatus(liveSourceLinkFor(link) ?? link, nextValue);
    return true;
  };

  const nudgeStatusSourceLink = (direction: -1 | 1, modifiers: ScrubModifiers) => {
    const link = liveSourceLinkFor(selectedSourceLink);
    if (!link) return;
    nudgeSourceLink(link, direction, modifiers, {
      editSessionId: nextEditSessionId("source-status-step"),
    });
  };

  const selectSourceLink = (
    link: GraphSourceLink,
    options: SourceLinkSelectOptions & { reveal?: boolean; selectRange?: boolean } = {},
  ): boolean => {
    const range = rangeForSourceLink(editor, link);
    if (!range) return false;
    cursorLinkKey = sourceLinkKey(link);
    markSelectedSourceLink(link, { reveal: options.reveal });
    if (options.selectRange) {
      editor.setSelection(range);
    }
    if (options.reveal) {
      editor.revealRangeInCenterIfOutsideViewport(range);
    }
    onSourceLinkSelect(link, { revealGraph: options.revealGraph });
    editor.focus();
    return true;
  };

  const updateSourceLinkStatus = (link: GraphSourceLink | null, valueOverride?: number | null) => {
    const range = link ? rangeForSourceLink(editor, link) : null;
    if (!link || !range) {
      sourceLinkStatusBar.update(null);
      return;
    }
    const value = valueOverride !== undefined
      ? valueOverride
      : isScrubbableSourceLink(link)
        ? readSourceLinkNumber(editor.getValue(), link)
        : null;
    sourceLinkStatusBar.update(link, {
      value,
      navigation: sourceLinkNavigationState(link),
    });
  };

  const currentSourceLinkForNavigation = (): GraphSourceLink | null => {
    return liveSourceLinkFor(linkAtPosition(editor.getPosition(), { sticky: true }))
      ?? liveSourceLinkFor(selectedSourceLink)
      ?? liveSourceLinkFor(hoveredLink);
  };

  const sourceLinkNavigationState = (link: GraphSourceLink): { index: number; total: number } => {
    const ordered = navigableSourceLinks(sourceLinks);
    return {
      index: ordered.findIndex((candidate) => sourceLinkNavigationKey(candidate) === sourceLinkNavigationKey(link)),
      total: ordered.length,
    };
  };

  const selectAdjacentSourceLink = (direction: -1 | 1): boolean => {
    const nextLink = adjacentSourceLink(sourceLinks, currentSourceLinkForNavigation(), direction);
    return nextLink ? selectSourceLink(nextLink, { reveal: true, selectRange: true }) : false;
  };

  const revealCurrentSourceLinkInGraph = (): boolean => {
    const link = currentSourceLinkForNavigation();
    return link ? selectSourceLink(link, { reveal: true, selectRange: true, revealGraph: true }) : false;
  };

  const applyPreferredQuickFix = (): boolean => {
    return applyEditorPreferredQuickFix(editor);
  };

  const runtimeDiagnosticCount = (): number => {
    return editorRuntimeDiagnosticCount(editor);
  };

  const scheduleCursorSourceLinkSync = (position: monaco.Position | null | undefined) => {
    if (suppress || activeScrub) return;
    pendingCursorPosition = position ?? null;
    if (cursorSyncFrame || cursorSyncFallbackTimer) return;
    const sync = () => {
      if (cursorSyncFrame) window.cancelAnimationFrame(cursorSyncFrame);
      if (cursorSyncFallbackTimer) window.clearTimeout(cursorSyncFallbackTimer);
      cursorSyncFrame = 0;
      cursorSyncFallbackTimer = 0;
      const nextPosition = pendingCursorPosition;
      pendingCursorPosition = null;
      syncCursorSourceLink(nextPosition);
    };
    cursorSyncFrame = window.requestAnimationFrame(sync);
    cursorSyncFallbackTimer = window.setTimeout(sync, 50);
  };

  const cancelCursorSourceLinkSync = () => {
    if (cursorSyncFrame) window.cancelAnimationFrame(cursorSyncFrame);
    if (cursorSyncFallbackTimer) window.clearTimeout(cursorSyncFallbackTimer);
    cursorSyncFrame = 0;
    cursorSyncFallbackTimer = 0;
    pendingCursorPosition = null;
  };

  const applyFocusedNodeDecorations = (reveal: boolean) => {
    const model = editor.getModel();
    if (!model || focusedNodeId == null) {
      focusedNodeDecorations = editor.deltaDecorations(focusedNodeDecorations, []);
      return;
    }

    const links = sourceLinks.filter((link) => link.nodeId === focusedNodeId && link.end > link.start);
    focusedNodeDecorations = updateFocusedSourceLinkDecorations(editor, focusedNodeDecorations, links);

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
    onSourceLinkSelect(link, {
      revealGraph: event.event.browserEvent.metaKey || event.event.browserEvent.ctrlKey,
    });

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
    pointerLink = linkAtPosition(event.target.position, { sticky: true });
    updateHover(pointerLink, event.event.browserEvent.shiftKey || shiftDown);
  });
  const cursorSubscription = editor.onDidChangeCursorPosition((event) => {
    scheduleCursorSourceLinkSync(event.position);
  });
  const editorActions = installCodeEditorActions(editor, {
    onPrettify() {
      onPrettify();
    },
    onQuickFix() {
      applyPreferredQuickFix();
    },
    onSelectAdjacentSourceLink(direction) {
      selectAdjacentSourceLink(direction);
    },
    onRevealSourceLinkInGraph() {
      revealCurrentSourceLinkInGraph();
    },
    onNudgeSourceLink(direction, modifiers) {
      return nudgeCurrentSourceLink(direction, modifiers);
    },
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
      clearSourceInlayHintState();
    },
    getValue() {
      return editor.getValue();
    },
    setError(error: CodeEditorError | null) {
      setEditorRuntimeError(editor, error);
    },
    runtimeDiagnosticCount() {
      return runtimeDiagnosticCount();
    },
    setSourceLinks(links: readonly GraphSourceLink[]) {
      updateHover(null, false, { immediateClear: true });
      pointerLink = null;
      sourceLinks = [...links];
      const model = editor.getModel();
      if (!model) return;
      updateSourceInlayHintState(sourceLinks);
      revealedSourceDecorations = clearSourceLinkDecorations(editor, revealedSourceDecorations);
      localHoveredSourceDecorations = clearSourceLinkDecorations(editor, localHoveredSourceDecorations);
      hoveredSourceDecorations = clearSourceLinkDecorations(editor, hoveredSourceDecorations);
      editedSourceDecorations = clearSourceLinkDecorations(editor, editedSourceDecorations);
      sourceLinkDecorations = updateGraphSourceLinkDecorations(editor, sourceLinkDecorations, sourceLinks, (link) => {
        return isScrubbableSourceLink(link) && readSourceLinkNumber(editor.getValue(), link) != null;
      });
      applyFocusedNodeDecorations(false);
      selectedSourceLink = liveSourceLinkFor(selectedSourceLink);
      markSelectedSourceLink(selectedSourceLink);
      cursorLinkKey = null;
      scheduleCursorSourceLinkSync(editor.getPosition());
    },
    setGraphHintsEnabled(enabled: boolean) {
      editor.updateOptions({
        inlayHints: {
          enabled: enabled ? "on" : "off",
          padding: true,
          maximumLength: 18,
        },
      });
      refreshSourceInlayHints();
    },
    setFocusedNode(nodeId: number | null, options: { reveal?: boolean } = {}) {
      focusedNodeId = nodeId;
      applyFocusedNodeDecorations(Boolean(options.reveal));
    },
    markSelectedSourceLink(link: GraphSourceLink | null, options: { reveal?: boolean } = {}) {
      cancelCursorSourceLinkSync();
      cursorLinkKey = sourceLinkKey(link);
      markSelectedSourceLink(link, options);
    },
    markHoveredSourceLink(link: GraphSourceLink | null) {
      markHoveredSourceLink(link);
    },
    markEditedSourceLink(link: GraphSourceLink | null, options: { reveal?: boolean } = {}) {
      const range = link ? rangeForSourceLink(editor, link) : null;
      editedSourceDecorations = updateSourceLinkDecoration(editor, editedSourceDecorations, link, "edited");
      if (options.reveal && range) {
        editor.revealRangeInCenterIfOutsideViewport(range);
      }
    },
    revealSourceLink(link: GraphSourceLink) {
      const range = rangeForSourceLink(editor, link);
      if (!range) return;
      cancelCursorSourceLinkSync();
      selectedSourceLink = link;
      updateSourceLinkStatus(link);
      revealedSourceDecorations = updateSourceLinkDecoration(editor, revealedSourceDecorations, link, "revealed");
      editor.setSelection(range);
      editor.revealRangeInCenterIfOutsideViewport(range);
      editor.focus();
    },
    nudgeCurrentSourceLink(direction, modifiers, options) {
      return nudgeCurrentSourceLink(direction, modifiers, options);
    },
    applyPreferredQuickFix() {
      return applyPreferredQuickFix();
    },
    selectAdjacentSourceLink(direction) {
      return selectAdjacentSourceLink(direction);
    },
    revealCurrentSourceLinkInGraph() {
      return revealCurrentSourceLinkInGraph();
    },
    sourceDecorationCount(kind) {
      switch (kind) {
        case "hovered":
          return hoveredSourceDecorations.length + localHoveredSourceDecorations.length;
        case "edited":
          return editedSourceDecorations.length;
        case "selected":
          return selectedSourceDecorations.length;
        case "revealed":
          return revealedSourceDecorations.length;
      }
      return 0;
    },
    blur() {
      const domNode = editor.getDomNode();
      const active = document.activeElement;
      if (active instanceof HTMLElement && domNode?.contains(active)) {
        active.blur();
        return;
      }
      domNode?.blur();
    },
    layout() {
      editor.layout();
    },
    dispose() {
      endScrub();
      cancelCursorSourceLinkSync();
      clearKeyboardNudgeSession();
      scrubReadout.hide();
      clearHoverTimer();
      cancelCursorSourceLinkSync();
      updateHover(null, false, { immediateClear: true });
      window.removeEventListener("keydown", keyDownListener);
      window.removeEventListener("keyup", keyUpListener);
      subscription.dispose();
      linkSubscription.dispose();
      hoverSubscription.dispose();
      cursorSubscription.dispose();
      editorActions.dispose();
      leaveSubscription.dispose();
      deleteSourceInlayHintState();
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

let nextSourceEditSession = 1;

function nextEditSessionId(prefix: string): string {
  const id = nextSourceEditSession;
  nextSourceEditSession += 1;
  return `${prefix}:${id}`;
}
