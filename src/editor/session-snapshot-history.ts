import {
  listSessionSnapshots,
  readSessionSnapshotCode,
  restoreSessionSnapshot,
  type SessionSnapshot,
} from "./session-snapshot-client";

export interface SessionSnapshotHistoryElements {
  button: HTMLButtonElement;
  dialog: HTMLDialogElement;
  closeButton: HTMLButtonElement;
  slider: HTMLInputElement;
  sliderOutput: HTMLOutputElement;
  list: HTMLElement;
  preview: HTMLElement;
  meta: HTMLElement;
  comment: HTMLElement;
  codeLink: HTMLAnchorElement;
  restoreButton: HTMLButtonElement;
  status: HTMLElement;
}

export interface SessionSnapshotHistoryOptions {
  sessionId: string | null;
  elements: SessionSnapshotHistoryElements;
  clientId(): string | null;
  hasUnsavedChanges(): boolean;
  confirm(message: string): boolean;
  onRestoreComplete?(snapshot: SessionSnapshot | null, restoredSource: string | null): void | Promise<void>;
  onSnapshotsChanged?(): void | Promise<void>;
}

export interface SessionSnapshotHistoryController {
  configure(): void;
  refresh(): Promise<void>;
  openDialog(): Promise<void>;
}

export function createSessionSnapshotHistory(options: SessionSnapshotHistoryOptions): SessionSnapshotHistoryController {
  const { elements, sessionId } = options;
  let configured = false;
  let snapshots: SessionSnapshot[] = [];
  let selectedIndex = -1;
  let loading = false;
  let restoring = false;
  let statusMessage = "";
  let errorMessage = "";

  async function openDialog(): Promise<void> {
    if (!sessionId) return;
    statusMessage = "";
    errorMessage = "";
    render();
    if (!elements.dialog.open) elements.dialog.showModal();
    await refreshSnapshots({ selectLatest: true });
  }

  async function refresh(): Promise<void> {
    if (!sessionId) return;
    await refreshSnapshots({ selectSnapshotId: selectedSnapshot()?.id ?? null });
  }

  async function refreshSnapshots(refreshOptions: { selectLatest?: boolean; selectSnapshotId?: string | null } = {}): Promise<void> {
    loading = true;
    errorMessage = "";
    render();
    try {
      snapshots = await listSessionSnapshots(sessionId!);
      if (refreshOptions.selectSnapshotId) {
        const index = snapshots.findIndex((snapshot) => snapshot.id === refreshOptions.selectSnapshotId);
        selectedIndex = index >= 0 ? index : snapshots.length - 1;
      } else if (refreshOptions.selectLatest || selectedIndex < 0) {
        selectedIndex = snapshots.length - 1;
      } else {
        selectedIndex = clampIndex(selectedIndex);
      }
    } catch (error) {
      snapshots = [];
      selectedIndex = -1;
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
      render();
    }
  }

  async function restoreSelected(): Promise<void> {
    const snapshot = selectedSnapshot();
    if (!sessionId || !snapshot || !snapshot.codeUrl || restoring) return;
    const clientId = options.clientId();
    if (!clientId) {
      errorMessage = "This browser tab is not connected.";
      render();
      return;
    }

    const dirtyWarning = options.hasUnsavedChanges() ? " Unsaved editor changes will be replaced." : "";
    const message = `Restore snapshot ${snapshot.id} as the latest project state? A new snapshot will be appended.${dirtyWarning}`;
    if (!options.confirm(message)) return;

    restoring = true;
    statusMessage = `Restoring ${snapshot.id}`;
    errorMessage = "";
    render();
    try {
      const body = await restoreSessionSnapshot(
        sessionId,
        snapshot.id,
        `Restoring snapshot ${snapshot.id} from project snapshots.`,
        clientId,
      );
      const nextSnapshotId = body.snapshot?.id ?? null;
      const restoredSource = await safeReadSnapshotCode(body.snapshot ?? null);
      statusMessage = nextSnapshotId ? `Restored ${snapshot.id} as ${nextSnapshotId}` : `Restored ${snapshot.id}`;
      await refreshSnapshots(nextSnapshotId ? { selectSnapshotId: nextSnapshotId } : { selectLatest: true });
      await options.onRestoreComplete?.(selectedSnapshot(), restoredSource);
      await options.onSnapshotsChanged?.();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      restoring = false;
      render();
    }
  }

  function render(): void {
    renderButton();
    renderScrubber();
    renderList();
    renderDetail();
  }

  function renderButton(): void {
    const count = snapshots.length;
    elements.button.textContent = count > 0 ? `${count} snapshot${count === 1 ? "" : "s"}` : "Snapshots";
    elements.button.title = count > 0 ? `Project snapshots (${count})` : "Project snapshots";
  }

  function renderScrubber(): void {
    elements.slider.disabled = loading || snapshots.length <= 1;
    elements.slider.min = "0";
    elements.slider.max = String(Math.max(0, snapshots.length - 1));
    elements.slider.value = String(Math.max(0, selectedIndex));
    elements.sliderOutput.value = snapshots.length > 0 ? `${selectedIndex + 1} / ${snapshots.length}` : "0 / 0";
  }

  function renderList(): void {
    if (loading) {
      elements.list.replaceChildren(renderMessage("Loading snapshots"));
      return;
    }
    if (errorMessage) {
      elements.list.replaceChildren(renderMessage("Could not load snapshots"));
      return;
    }
    if (snapshots.length === 0) {
      elements.list.replaceChildren(renderMessage("No project snapshots yet"));
      return;
    }
    const rows = snapshots
      .map((snapshot, index) => ({ snapshot, index }))
      .reverse()
      .map(({ snapshot, index }) => renderSnapshotButton(snapshot, index));
    elements.list.replaceChildren(...rows);
  }

  function renderDetail(): void {
    const snapshot = selectedSnapshot();
    elements.status.textContent = errorMessage || statusMessage;
    elements.status.dataset.state = errorMessage ? "error" : statusMessage ? "ok" : "idle";

    if (!snapshot) {
      elements.preview.replaceChildren(renderPreviewFallback("No snapshot selected"));
      elements.meta.textContent = "-";
      elements.comment.textContent = "";
      elements.comment.hidden = true;
      elements.codeLink.hidden = true;
      elements.codeLink.removeAttribute("href");
      elements.restoreButton.disabled = true;
      elements.restoreButton.textContent = "Restore as Latest";
      return;
    }

    if (snapshot.screenshotUrl) {
      const image = document.createElement("img");
      image.src = snapshot.screenshotUrl;
      image.alt = "";
      image.loading = "lazy";
      elements.preview.replaceChildren(image);
    } else {
      elements.preview.replaceChildren(renderPreviewFallback("No preview"));
    }

    elements.meta.textContent = snapshotMeta(snapshot, selectedIndex === snapshots.length - 1);
    elements.comment.textContent = snapshot.comment || "";
    elements.comment.hidden = !snapshot.comment;
    elements.codeLink.hidden = !snapshot.codeUrl;
    if (snapshot.codeUrl) elements.codeLink.href = snapshot.codeUrl;
    else elements.codeLink.removeAttribute("href");
    elements.restoreButton.disabled = restoring || !snapshot.codeUrl;
    elements.restoreButton.textContent = restoring ? "Restoring" : "Restore as Latest";
  }

  function renderSnapshotButton(snapshot: SessionSnapshot, index: number): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "snapshot-history-item";
    button.setAttribute("aria-current", String(index === selectedIndex));
    button.addEventListener("click", () => {
      selectedIndex = index;
      statusMessage = "";
      errorMessage = "";
      render();
    });

    const heading = document.createElement("span");
    heading.className = "snapshot-history-item-heading";

    const id = document.createElement("strong");
    id.textContent = snapshot.id;
    heading.append(id);
    if (index === snapshots.length - 1) heading.append(renderBadge("Current"));

    const meta = document.createElement("small");
    meta.textContent = snapshotListMeta(snapshot);

    const comment = document.createElement("span");
    comment.textContent = snapshot.comment || snapshot.status || "";

    button.append(heading, meta, comment);
    return button;
  }

  function selectedSnapshot(): SessionSnapshot | null {
    return snapshots[clampIndex(selectedIndex)] ?? null;
  }

  function clampIndex(index: number): number {
    if (snapshots.length === 0) return -1;
    return Math.min(snapshots.length - 1, Math.max(0, index));
  }

  function closeDialog(): void {
    elements.dialog.close();
  }

  return {
    configure() {
      if (configured) return;
      configured = true;
      if (!sessionId) {
        elements.button.disabled = true;
        return;
      }
      elements.button.addEventListener("click", () => void openDialog());
      elements.closeButton.addEventListener("click", closeDialog);
      const handleScrub = () => {
        selectedIndex = Number(elements.slider.value);
        statusMessage = "";
        errorMessage = "";
        render();
      };
      elements.slider.addEventListener("input", handleScrub);
      elements.slider.addEventListener("change", handleScrub);
      elements.restoreButton.addEventListener("click", () => void restoreSelected());
      elements.dialog.addEventListener("click", (event) => {
        if (event.target === elements.dialog) elements.dialog.close();
      });
      elements.dialog.addEventListener("close", () => {
        elements.button.focus({ preventScroll: true });
      });
      void refresh();
    },
    refresh,
    openDialog,
  };
}

function renderBadge(label: string): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "project-badge";
  badge.textContent = label;
  return badge;
}

function renderMessage(message: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "project-empty";
  element.textContent = message;
  return element;
}

function renderPreviewFallback(message: string): HTMLElement {
  const element = document.createElement("span");
  element.textContent = message;
  return element;
}

async function safeReadSnapshotCode(snapshot: SessionSnapshot | null): Promise<string | null> {
  try {
    return await readSessionSnapshotCode(snapshot);
  } catch {
    return null;
  }
}

function snapshotListMeta(snapshot: SessionSnapshot): string {
  return [
    formatSnapshotTime(snapshot.createdAt),
    snapshot.kind || "snapshot",
    snapshot.sourceValid === false ? "code error" : "valid",
  ].filter(Boolean).join(" / ");
}

function snapshotMeta(snapshot: SessionSnapshot, current: boolean): string {
  const parts = [
    `Snapshot ${snapshot.id}`,
    current ? "current" : "",
    formatSnapshotTime(snapshot.createdAt),
    snapshot.kind || "snapshot",
    snapshot.sourceValid === false ? "code error" : "valid source",
  ];
  if (snapshot.restoredSnapshotId) parts.push(`restored from ${snapshot.restoredSnapshotId}`);
  if (snapshot.status) parts.push(snapshot.status);
  return parts.filter(Boolean).join(" / ");
}

function formatSnapshotTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}
