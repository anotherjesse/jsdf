import type { GraphParamEdit, ParamPath, ParamValue } from "./graph-inspector";

export interface GraphHistoryEntry {
  id: number;
  nodeId: number;
  nodeKind: string;
  path: ParamPath;
  label: string;
  previousValue: ParamValue;
  nextValue: ParamValue;
  editSessionId?: string;
  timestamp: number;
}

export class GraphEditHistory {
  private readonly undoStack: GraphHistoryEntry[] = [];
  private readonly redoStack: GraphHistoryEntry[] = [];
  private nextId = 1;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get dirtyCount(): number {
    return this.undoStack.length;
  }

  current(): readonly GraphHistoryEntry[] {
    return this.undoStack;
  }

  record(edit: GraphParamEdit, now = performance.now()): void {
    const last = this.undoStack.at(-1);
    this.redoStack.length = 0;
    if (last && last.nodeId === edit.nodeId && samePath(last.path, edit.path) && shouldMergeEdits(last, edit, now)) {
      last.nextValue = edit.nextValue;
      last.timestamp = now;
      return;
    }

    this.undoStack.push({
      id: this.nextId,
      nodeId: edit.nodeId,
      nodeKind: edit.nodeKind,
      path: [...edit.path],
      label: edit.label,
      previousValue: edit.previousValue,
      nextValue: edit.nextValue,
      ...(edit.editSessionId ? { editSessionId: edit.editSessionId } : {}),
      timestamp: now,
    });
    this.nextId += 1;
  }

  undo(apply: (entry: GraphHistoryEntry) => boolean, now = performance.now()): GraphHistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    if (!apply(entry)) {
      this.undoStack.push(entry);
      return null;
    }
    this.redoStack.push({ ...entry, timestamp: now });
    return entry;
  }

  redo(apply: (entry: GraphHistoryEntry) => boolean, now = performance.now()): GraphHistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    if (!apply(entry)) {
      this.redoStack.push(entry);
      return null;
    }
    this.undoStack.push({ ...entry, timestamp: now });
    return entry;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

function shouldMergeEdits(last: GraphHistoryEntry, edit: GraphParamEdit, now: number): boolean {
  if (last.editSessionId || edit.editSessionId) return last.editSessionId === edit.editSessionId;
  return now - last.timestamp < 700;
}

export function samePath(a: ParamPath, b: ParamPath): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

export function formatGraphValue(value: ParamValue): string {
  if (typeof value !== "number") {
    if (Array.isArray(value)) return "[...]";
    if (value && typeof value === "object") return "{...}";
    return String(value);
  }
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(4).replace(/\.?0+$/, "");
}

export function formatGraphChangeValue(entry: Pick<GraphHistoryEntry, "label" | "previousValue" | "nextValue">): string {
  return `${entry.label} ${formatGraphValue(entry.previousValue)} -> ${formatGraphValue(entry.nextValue)}`;
}
