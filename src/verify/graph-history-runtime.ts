import type { GraphParamEdit } from "../editor/graph-edit-model";
import { renderGraphChangeJournal } from "../editor/graph-change-journal";
import { GraphEditHistory, formatGraphChangeValue } from "../editor/graph-history";
import { scrubNumericParamValue } from "../editor/scrub-values";

export interface GraphScrubValuesVerification {
  count: number;
  smallRadius: number;
  fineRadius: number;
}

export interface GraphHistoryRuntimeVerification {
  sameSessionCount: number;
  separateSessionCount: number;
  timedCount: number;
  changeLabel: string;
  undoLabel: string;
  redoLabel: string;
}

export interface GraphChangeJournalVerification {
  hiddenWhenEmpty: boolean;
  renderedRows: number;
  overflowText: string;
  hoverShift: boolean;
  clearCount: number;
  revealSource: boolean;
  keyboardRevealSource: boolean;
  selectedRowPressed: string;
  rowTitle: string;
  rowShortcuts: string;
  sourceButtonLabel: string;
}

export function verifyScrubValues(errors: string[]): GraphScrubValuesVerification {
  const count = scrubNumericParamValue("count", 8, 0.49, { altKey: false, shiftKey: false });
  const smallRadius = scrubNumericParamValue("radius", 0.2, 20, { altKey: false, shiftKey: false });
  const fineRadius = scrubNumericParamValue("radius", 0.2, 20, { altKey: true, shiftKey: false });

  if (count !== 8) errors.push(`count scrub should stay integral near threshold: ${count}`);
  if (!closeTo(smallRadius, 0.3)) errors.push(`small radius scrub value ${smallRadius} !== 0.3`);
  if (!closeTo(fineRadius, 0.21)) errors.push(`fine radius scrub value ${fineRadius} !== 0.21`);

  return { count, smallRadius, fineRadius };
}

export function verifyHistoryCoalescing(errors: string[]): GraphHistoryRuntimeVerification {
  const sameSession = new GraphEditHistory();
  sameSession.record(edit("session-a", 1, 1.1), 0);
  sameSession.record(edit("session-a", 1.1, 1.2), 2000);
  if (sameSession.dirtyCount !== 1) errors.push(`same-session scrub history count ${sameSession.dirtyCount} !== 1`);

  const separateSession = new GraphEditHistory();
  separateSession.record(edit("session-a", 1, 1.1), 0);
  separateSession.record(edit("session-b", 1.1, 1.2), 100);
  if (separateSession.dirtyCount !== 2) errors.push(`separate-session history count ${separateSession.dirtyCount} !== 2`);

  const timed = new GraphEditHistory();
  timed.record(edit(undefined, 1, 1.1), 0);
  timed.record(edit(undefined, 1.1, 1.2), 100);
  if (timed.dirtyCount !== 1) errors.push(`timed edit history count ${timed.dirtyCount} !== 1`);
  const timedCount = timed.dirtyCount;
  const changeLabel = formatGraphChangeValue(timed.current()[0]);
  if (changeLabel !== "radius 1 -> 1.2") {
    errors.push(`graph change label rendered ${changeLabel}`);
  }
  const undoEntry = timed.peekUndo();
  const undoLabel = undoEntry ? `${undoEntry.nodeKind} #${undoEntry.nodeId} ${formatGraphChangeValue(undoEntry)}` : "";
  if (undoLabel !== "sphere #100 radius 1 -> 1.2") {
    errors.push(`graph undo peek rendered ${undoLabel || "nothing"}`);
  }
  timed.undo(() => true, 200);
  const redoEntry = timed.peekRedo();
  const redoLabel = redoEntry ? `${redoEntry.nodeKind} #${redoEntry.nodeId} ${formatGraphChangeValue(redoEntry)}` : "";
  if (redoLabel !== "sphere #100 radius 1 -> 1.2") {
    errors.push(`graph redo peek rendered ${redoLabel || "nothing"}`);
  }

  return {
    sameSessionCount: sameSession.dirtyCount,
    separateSessionCount: separateSession.dirtyCount,
    timedCount,
    changeLabel,
    undoLabel,
    redoLabel,
  };
}

export function verifyChangeJournal(errors: string[]): GraphChangeJournalVerification {
  const emptyRoot = document.createElement("div");
  const noopOptions = {
    entries: [],
    sourceLinkForEntry: () => null,
    onSelect: () => {},
    onHover: () => {},
    onClearHover: () => {},
  };
  renderGraphChangeJournal(emptyRoot, noopOptions);
  const hiddenWhenEmpty = emptyRoot.hidden;
  if (!hiddenWhenEmpty) errors.push("empty graph change journal stayed visible");

  const history = new GraphEditHistory();
  history.record(edit("journal-1", 1, 1.1), 0);
  history.record(edit("journal-2", 1.1, 1.2), 10);
  history.record(edit("journal-3", 1.2, 1.3), 20);
  history.record(edit("journal-4", 1.3, 1.4), 30);

  const root = document.createElement("div");
  const hoverEvents: Array<{ id: number; shiftKey: boolean }> = [];
  const selections: Array<{ id: number; revealSource?: boolean }> = [];
  let clearCount = 0;
  renderGraphChangeJournal(root, {
    entries: history.current(),
    sourceLinkForEntry: (entry) => ({
      nodeId: entry.nodeId,
      nodeKind: entry.nodeKind,
      path: entry.path,
      label: entry.label,
      start: 0,
      end: 6,
    }),
    selectedEntry: (entry) => entry.id === history.current().at(-1)?.id,
    onSelect(entry, options) {
      selections.push({ id: entry.id, revealSource: options.revealSource });
    },
    onHover(entry, options) {
      hoverEvents.push({ id: entry.id, shiftKey: options.shiftKey });
    },
    onClearHover() {
      clearCount += 1;
    },
  });

  const renderedRows = root.querySelectorAll(".change-entry-row").length;
  const overflowText = root.querySelector(".change-journal-more")?.textContent ?? "";
  if (renderedRows !== 3) errors.push(`graph change journal rendered ${renderedRows} visible rows`);
  if (overflowText !== "+1") errors.push(`graph change journal overflow rendered ${overflowText || "nothing"}`);
  const firstRow = root.querySelector<HTMLElement>(".change-entry-row");
  firstRow?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, shiftKey: true }));
  firstRow?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
  const firstEntry = root.querySelector<HTMLButtonElement>(".change-entry");
  const sourceButton = root.querySelector<HTMLButtonElement>(".change-entry-source");
  const rowTitle = firstEntry?.title ?? "";
  const rowShortcuts = firstEntry?.getAttribute("aria-keyshortcuts") ?? "";
  const selectedRowPressed = firstEntry?.getAttribute("aria-pressed") ?? "";
  const sourceButtonLabel = sourceButton?.getAttribute("aria-label") ?? "";
  sourceButton?.click();
  const revealSource = selections.at(-1)?.revealSource === true;
  firstEntry?.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    key: "Enter",
    metaKey: true,
  }));

  const hoverShift = hoverEvents.at(-1)?.shiftKey === true;
  const keyboardRevealSource = selections.at(-1)?.revealSource === true;
  if (!hoverShift) errors.push("graph change journal hover did not preserve shift focus");
  if (clearCount !== 1) errors.push(`graph change journal clear count ${clearCount} !== 1`);
  if (!revealSource) errors.push("graph change journal source button did not request reveal");
  if (!keyboardRevealSource) errors.push("graph change journal keyboard shortcut did not request reveal");
  if (!rowTitle.includes("Cmd/Ctrl-click or Cmd/Ctrl+Enter to reveal edited code")) {
    errors.push(`graph change journal row title rendered ${rowTitle || "nothing"}`);
  }
  if (rowShortcuts !== "Control+Enter Meta+Enter") {
    errors.push(`graph change journal shortcuts rendered ${rowShortcuts || "nothing"}`);
  }
  if (selectedRowPressed !== "true") {
    errors.push(`graph change journal selected row rendered ${selectedRowPressed || "nothing"}`);
  }
  if (!sourceButtonLabel.includes("Reveal edited sphere radius in Code")) {
    errors.push(`graph change journal source label rendered ${sourceButtonLabel || "nothing"}`);
  }

  return {
    hiddenWhenEmpty,
    renderedRows,
    overflowText,
    hoverShift,
    clearCount,
    revealSource,
    keyboardRevealSource,
    selectedRowPressed,
    rowTitle,
    rowShortcuts,
    sourceButtonLabel,
  };
}

function edit(editSessionId: string | undefined, previousValue: number, nextValue: number): GraphParamEdit {
  return {
    node: { id: 100, dim: 3, kind: "sphere", params: {}, children: [] },
    nodeId: 100,
    nodeKind: "sphere",
    path: ["radius"],
    label: "radius",
    previousValue,
    nextValue,
    ...(editSessionId ? { editSessionId } : {}),
  };
}

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}
