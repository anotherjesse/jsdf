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

export function renderSourceDialog(
  root: HTMLElement,
  state: SourceDialogState,
  actions: SourceDialogActions,
): void {
  root.replaceChildren(
    renderExampleSection(state, actions),
    renderSavedSection(state, actions),
  );
}

function renderExampleSection(state: SourceDialogState, actions: SourceDialogActions): HTMLElement {
  const section = document.createElement("section");
  section.className = "source-section";
  section.append(renderSectionTitle("Examples"));

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

function renderSavedSection(state: SourceDialogState, actions: SourceDialogActions): HTMLElement {
  const section = document.createElement("section");
  section.className = "source-section";
  section.append(renderSectionTitle("Saved"));

  if (state.savedDocuments.length === 0) {
    const empty = document.createElement("div");
    empty.className = "source-empty";
    empty.textContent = "No saved shapes yet";
    section.append(empty);
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
