import type { GraphSourceLink } from "./clean-source-patch";
import { renderGraphChangeJournal } from "./graph-change-journal";
import { formatGraphChangeValue, GraphEditHistory, type GraphHistoryEntry } from "./graph-history";
import type { GraphParamEdit, ParamValue } from "./graph-inspector";

export type { GraphHistoryEntry } from "./graph-history";

export interface GraphHistoryControllerElements {
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  journal: HTMLElement;
}

export interface GraphHistoryControllerOptions {
  elements: GraphHistoryControllerElements;
  applyEditValue(entry: GraphHistoryEntry, value: ParamValue): boolean;
  syncResetEdit(entry: GraphHistoryEntry, value: ParamValue): void;
  onMutationStatus(message: string, entry?: GraphHistoryEntry, value?: ParamValue): void;
  onDirtyEntriesChange(entries: readonly GraphHistoryEntry[]): void;
  onBeforeRenderJournal?(): void;
  sourceLinkForEntry(entry: GraphHistoryEntry): GraphSourceLink | null;
  selectedEntry(entry: GraphHistoryEntry): boolean;
  onSelectEntry(entry: GraphHistoryEntry, options: { revealSource?: boolean }): void;
  onHoverEntry(entry: GraphHistoryEntry, options: { shiftKey: boolean }): void;
  onClearEntryHover(): void;
}

export interface GraphHistoryController {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  record(edit: GraphParamEdit): void;
  undo(): void;
  redo(): void;
  reset(): void;
  clear(): void;
  refresh(): void;
}

export function createGraphHistoryController(options: GraphHistoryControllerOptions): GraphHistoryController {
  const history = new GraphEditHistory();
  const { undoButton, redoButton, resetButton, journal } = options.elements;

  function record(edit: GraphParamEdit): void {
    history.record(edit);
    refresh();
  }

  function undo(): void {
    const entry = history.undo((candidate) => options.applyEditValue(candidate, candidate.previousValue));
    refresh();
    if (!entry) return;
    options.onMutationStatus(`Undid ${entry.nodeKind} ${entry.label}`, entry, entry.previousValue);
  }

  function redo(): void {
    const entry = history.redo((candidate) => options.applyEditValue(candidate, candidate.nextValue));
    refresh();
    if (!entry) return;
    options.onMutationStatus(`Redid ${entry.nodeKind} ${entry.label}`, entry, entry.nextValue);
  }

  function reset(): void {
    if (!history.canUndo) return;
    let didReset = false;
    while (history.canUndo) {
      const entry = history.undo((candidate) => options.applyEditValue(candidate, candidate.previousValue));
      if (!entry) break;
      options.syncResetEdit(entry, entry.previousValue);
      didReset = true;
    }
    history.clear();
    refresh();
    if (didReset) options.onMutationStatus("Reset graph");
  }

  function clear(): void {
    history.clear();
    refresh();
  }

  function refresh(): void {
    undoButton.disabled = !history.canUndo;
    redoButton.disabled = !history.canRedo;
    resetButton.disabled = !history.canUndo;
    updateButtonLabels();

    const entries = history.current();
    options.onDirtyEntriesChange(entries);
    options.onBeforeRenderJournal?.();
    renderGraphChangeJournal(journal, {
      entries,
      sourceLinkForEntry: options.sourceLinkForEntry,
      selectedEntry: options.selectedEntry,
      onSelect: options.onSelectEntry,
      onHover: options.onHoverEntry,
      onClearHover: options.onClearEntryHover,
    });
  }

  function updateButtonLabels(): void {
    const undoEntry = history.peekUndo();
    const redoEntry = history.peekRedo();
    const dirtyCount = history.dirtyCount;

    const undoLabel = undoEntry ? `Undo ${graphChangeSummary(undoEntry)}` : "Undo graph edit";
    undoButton.title = undoEntry ? `${undoLabel} (Cmd/Ctrl+Z)` : "Undo graph edit (Cmd/Ctrl+Z)";
    undoButton.setAttribute("aria-label", undoLabel);

    const redoLabel = redoEntry ? `Redo ${graphChangeSummary(redoEntry)}` : "Redo graph edit";
    redoButton.title = redoEntry ? `${redoLabel} (Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y)` : "Redo graph edit (Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y)";
    redoButton.setAttribute("aria-label", redoLabel);

    const resetLabel = dirtyCount > 0
      ? `Reset ${dirtyCount} graph ${dirtyCount === 1 ? "edit" : "edits"}`
      : "Reset graph edits";
    resetButton.title = resetLabel;
    resetButton.setAttribute("aria-label", resetLabel);
  }

  const controller: GraphHistoryController = {
    get canUndo(): boolean {
      return history.canUndo;
    },
    get canRedo(): boolean {
      return history.canRedo;
    },
    record,
    undo,
    redo,
    reset,
    clear,
    refresh,
  };

  undoButton.addEventListener("click", controller.undo);
  redoButton.addEventListener("click", controller.redo);
  resetButton.addEventListener("click", controller.reset);
  refresh();

  return controller;
}

function graphChangeSummary(entry: GraphHistoryEntry): string {
  return `${entry.nodeKind} #${entry.nodeId} ${formatGraphChangeValue(entry)}`;
}
