import type { GraphSourceLink } from "./clean-source-patch";
import { formatGraphChangeValue, type GraphHistoryEntry } from "./graph-history";

export interface GraphChangeJournalOptions {
  entries: readonly GraphHistoryEntry[];
  sourceLinkForEntry(entry: GraphHistoryEntry): GraphSourceLink | null;
  onSelect(entry: GraphHistoryEntry, options: { revealSource?: boolean }): void;
  onHover(entry: GraphHistoryEntry, options: { shiftKey: boolean }): void;
  onClearHover(): void;
}

export function renderGraphChangeJournal(container: HTMLElement, options: GraphChangeJournalOptions): void {
  const { entries } = options;
  container.replaceChildren();
  container.hidden = entries.length === 0;
  if (entries.length === 0) return;

  const count = document.createElement("span");
  count.className = "change-journal-count";
  count.textContent = `${entries.length} ${entries.length === 1 ? "change" : "changes"}`;

  const list = document.createElement("div");
  list.className = "change-journal-list";
  const visibleEntries = entries.slice(-3).reverse();
  for (const entry of visibleEntries) {
    list.append(renderGraphChangeEntry(entry, options));
  }
  if (entries.length > visibleEntries.length) {
    const overflow = document.createElement("span");
    overflow.className = "change-journal-more";
    overflow.textContent = `+${entries.length - visibleEntries.length}`;
    list.append(overflow);
  }

  container.append(count, list);
}

function renderGraphChangeEntry(entry: GraphHistoryEntry, options: GraphChangeJournalOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "change-entry-row";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "change-entry";
  const sourceLink = options.sourceLinkForEntry(entry);
  const sourceHint = sourceLink ? "; Cmd/Ctrl-click to show code" : "";
  const changeLabel = formatGraphChangeValue(entry);
  button.title = `Select ${entry.nodeKind} #${entry.nodeId}: ${changeLabel}${sourceHint}`;
  button.setAttribute("aria-label", button.title);
  button.dataset.nodeId = String(entry.nodeId);
  if (sourceLink) button.dataset.hasSource = "true";

  const node = document.createElement("span");
  node.className = "change-entry-node";
  node.textContent = `${entry.nodeKind} #${entry.nodeId}`;

  const value = document.createElement("span");
  value.className = "change-entry-value";
  value.textContent = changeLabel;

  button.append(node, value);
  button.addEventListener("click", (event) => {
    options.onSelect(entry, { revealSource: event.metaKey || event.ctrlKey });
  });
  row.append(button);
  row.addEventListener("pointerenter", (event) => options.onHover(entry, { shiftKey: event.shiftKey }));
  row.addEventListener("pointermove", (event) => options.onHover(entry, { shiftKey: event.shiftKey }));
  row.addEventListener("pointerleave", options.onClearHover);
  row.addEventListener("focusin", () => options.onHover(entry, { shiftKey: false }));
  row.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof globalThis.Node && row.contains(event.relatedTarget)) return;
    options.onClearHover();
  });

  if (sourceLink) {
    const source = document.createElement("button");
    source.type = "button";
    source.className = "change-entry-source icon-button";
    source.title = `Reveal ${entry.nodeKind} ${entry.label} in code`;
    source.setAttribute("aria-label", source.title);
    const icon = document.createElement("span");
    icon.className = "code-link-icon";
    icon.setAttribute("aria-hidden", "true");
    source.append(icon);
    source.addEventListener("click", () => options.onSelect(entry, { revealSource: true }));
    row.append(source);
  }

  return row;
}
