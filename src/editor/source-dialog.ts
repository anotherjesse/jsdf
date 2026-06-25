import type { Example } from "../examples";
import { latestSourceVersion, type SavedSourceDocument, type SavedSourceVersion } from "./workspace-storage";

export interface SourceDialogState {
  examples: readonly Example[];
  savedDocuments: readonly SavedSourceDocument[];
  activeExampleId: string;
  activeDocumentId: string | null;
  activeVersionId: string | null;
}

export interface SourceDialogActions {
  loadExample(id: string): void;
  loadSaved(documentId: string, versionId: string): void;
  deleteDocument(documentId: string): void;
  deleteVersion(documentId: string, versionId: string): void;
}

export interface SourceDialogController {
  focusSearch(): void;
}

const LOAD_BUTTON_SELECTOR = ".source-card, .source-version-button";

export function renderSourceDialog(
  root: HTMLElement,
  state: SourceDialogState,
  actions: SourceDialogActions,
): SourceDialogController {
  const search = document.createElement("input");
  search.type = "search";
  search.className = "source-search-input";
  search.placeholder = "Find a shape";
  search.autofocus = true;
  search.setAttribute("aria-label", "Find examples and saved shapes");

  const searchBar = document.createElement("div");
  searchBar.className = "source-search-bar";
  searchBar.append(search);

  const results = document.createElement("div");
  results.className = "source-dialog-results";
  let firstLoadResult: (() => void) | null = null;

  const loadButtons = (): HTMLButtonElement[] => {
    return [...results.querySelectorAll<HTMLButtonElement>(LOAD_BUTTON_SELECTOR)]
      .filter((button) => !button.closest("details:not([open])"));
  };

  const focusLoadButton = (index: number): boolean => {
    const buttons = loadButtons();
    const button = buttons[index];
    if (!button) return false;
    button.focus();
    return true;
  };

  const focusAdjacentLoadButton = (direction: -1 | 1): boolean => {
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement)) return false;
    const buttons = loadButtons();
    const index = buttons.indexOf(active);
    if (index < 0) return false;
    return focusLoadButton(clampIndex(index + direction, buttons.length));
  };

  const handleLoadNavigation = (event: KeyboardEvent): boolean => {
    if (event.key === "ArrowDown") return focusAdjacentLoadButton(1);
    if (event.key === "ArrowUp") return focusAdjacentLoadButton(-1);
    if (event.key === "Home") return focusLoadButton(0);
    if (event.key === "End") return focusLoadButton(loadButtons().length - 1);
    return false;
  };

  const renderResults = () => {
    const query = normalizeSearch(search.value);
    const filteredState = {
      ...state,
      examples: filterExamples(state.examples, query),
      savedDocuments: filterSavedDocuments(state.savedDocuments, query),
    };
    firstLoadResult = firstVisibleLoadAction(filteredState, actions);
    results.replaceChildren(
      renderExampleSection(filteredState, actions, query),
      renderSavedSection(filteredState, actions, query),
    );
  };

  search.addEventListener("input", renderResults);
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (event.isComposing || !firstLoadResult) return;
      event.preventDefault();
      firstLoadResult();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const index = event.key === "ArrowDown" ? 0 : loadButtons().length - 1;
      if (!focusLoadButton(index)) return;
      event.preventDefault();
    }
  });
  results.addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.matches(LOAD_BUTTON_SELECTOR)) return;
    if (!handleLoadNavigation(event)) return;
    event.preventDefault();
  });
  renderResults();
  root.replaceChildren(searchBar, results);

  return {
    focusSearch() {
      search.focus({ preventScroll: true });
      search.select();
    },
  };
}

function firstVisibleLoadAction(
  state: SourceDialogState,
  actions: SourceDialogActions,
): (() => void) | null {
  const example = state.examples[0];
  if (example) return () => actions.loadExample(example.id);

  for (const savedDocument of state.savedDocuments) {
    const latest = latestSourceVersion(savedDocument);
    if (latest) return () => actions.loadSaved(savedDocument.id, latest.id);
  }

  return null;
}

function renderExampleSection(state: SourceDialogState, actions: SourceDialogActions, query = ""): HTMLElement {
  const section = document.createElement("section");
  section.className = "source-section";
  section.append(renderSectionTitle("Examples"));

  if (state.examples.length === 0) {
    section.append(renderEmpty(query ? "No matching examples" : "No examples"));
    return section;
  }

  const grid = document.createElement("div");
  grid.className = "source-card-grid";
  for (const example of state.examples) {
    const button = renderSourceButton({
      name: example.name,
      pressed: state.activeDocumentId == null && state.activeExampleId === example.id,
    });
    button.addEventListener("click", () => actions.loadExample(example.id));
    grid.append(button);
  }

  section.append(grid);
  return section;
}

function renderSavedSection(state: SourceDialogState, actions: SourceDialogActions, query = ""): HTMLElement {
  const section = document.createElement("section");
  section.className = "source-section";
  section.append(renderSectionTitle("Saved"));

  if (state.savedDocuments.length === 0) {
    section.append(renderEmpty(query ? "No saved shapes match" : "No saved shapes yet"));
    return section;
  }

  const list = document.createElement("div");
  list.className = "saved-source-list";
  for (const savedDocument of state.savedDocuments) {
    list.append(renderSavedDocument(savedDocument, state, actions));
  }
  section.append(list);
  return section;
}

function renderSavedDocument(
  savedDocument: SavedSourceDocument,
  state: SourceDialogState,
  actions: SourceDialogActions,
): HTMLElement {
  const latest = latestSourceVersion(savedDocument);
  const item = document.createElement("div");
  item.className = "saved-source";
  if (!latest) return item;

  const latestRow = document.createElement("div");
  latestRow.className = "source-row";

  const latestButton = renderSourceButton({
    name: savedDocument.name,
    meta: `Saved ${formatVersionLabel(latest.createdAt)}${savedDocument.versions.length > 1 ? `, ${savedDocument.versions.length} versions` : ""}`,
    pressed: state.activeDocumentId === savedDocument.id && state.activeVersionId === latest.id,
  });
  latestButton.addEventListener("click", () => actions.loadSaved(savedDocument.id, latest.id));
  latestRow.append(
    latestButton,
    renderDeleteButton(`Delete ${savedDocument.name}`, () => actions.deleteDocument(savedDocument.id)),
  );
  item.append(latestRow);

  const olderVersions = savedDocument.versions.filter((version) => version.id !== latest.id);
  if (olderVersions.length > 0) {
    const details = document.createElement("details");
    details.className = "source-versions";
    details.open = olderVersions.some((version) => {
      return state.activeDocumentId === savedDocument.id && state.activeVersionId === version.id;
    });
    const summary = document.createElement("summary");
    summary.textContent = "Older versions";
    const versionList = document.createElement("div");
    versionList.className = "source-version-list";
    for (const version of olderVersions) {
      versionList.append(renderVersionRow(savedDocument, version, state, actions));
    }
    details.append(summary, versionList);
    item.append(details);
  }

  return item;
}

function renderVersionButton(
  savedDocument: SavedSourceDocument,
  version: SavedSourceVersion,
  state: SourceDialogState,
  actions: SourceDialogActions,
): HTMLButtonElement {
  const button = renderSourceButton({
    name: savedDocument.name,
    meta: formatVersionLabel(version.createdAt),
    pressed: state.activeDocumentId === savedDocument.id && state.activeVersionId === version.id,
    className: "source-version-button",
  });
  button.addEventListener("click", () => actions.loadSaved(savedDocument.id, version.id));
  return button;
}

function renderVersionRow(
  savedDocument: SavedSourceDocument,
  version: SavedSourceVersion,
  state: SourceDialogState,
  actions: SourceDialogActions,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "source-row source-version-row";
  row.append(
    renderVersionButton(savedDocument, version, state, actions),
    renderDeleteButton(`Delete ${savedDocument.name} version ${formatVersionLabel(version.createdAt)}`, () => {
      actions.deleteVersion(savedDocument.id, version.id);
    }),
  );
  return row;
}

function renderSourceButton(options: {
  name: string;
  meta?: string;
  pressed: boolean;
  className?: string;
}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = options.className ?? "source-card";
  button.setAttribute("aria-pressed", String(options.pressed));
  if (options.pressed) button.setAttribute("aria-current", "true");

  const name = document.createElement("strong");
  name.textContent = options.name;

  button.append(name);
  if (options.meta) {
    const meta = document.createElement("small");
    meta.textContent = options.meta;
    button.append(meta);
  }
  return button;
}

function renderEmpty(message: string): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "source-empty";
  empty.textContent = message;
  return empty;
}

function renderDeleteButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "source-delete-button icon-button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });

  const icon = document.createElement("span");
  icon.className = "trash-icon";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  return button;
}

function renderSectionTitle(title: string): HTMLHeadingElement {
  const heading = document.createElement("h3");
  heading.textContent = title;
  return heading;
}

function formatVersionLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function filterExamples(examples: readonly Example[], query: string): readonly Example[] {
  if (!query) return examples;
  return examples.filter((example) => {
    return matchesQuery(example.name, query) || matchesQuery(example.id, query);
  });
}

function filterSavedDocuments(
  savedDocuments: readonly SavedSourceDocument[],
  query: string,
): readonly SavedSourceDocument[] {
  if (!query) return savedDocuments;
  return savedDocuments.filter((document) => {
    return matchesQuery(document.name, query)
      || document.versions.some((version) => matchesQuery(formatVersionLabel(version.createdAt), query));
  });
}

function matchesQuery(value: string, query: string): boolean {
  return normalizeSearch(value).includes(query);
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  return Math.min(length - 1, Math.max(0, index));
}
