import type { AppHealthDiagnostics } from "../editor/app-health";
import { safeFrameDocument } from "./app-health-frame-runtime";

export interface AppHealthDomSummary {
  title: string;
  canvasMode: string;
  workspaceButtons: readonly string[];
  workspaceButtonShortcuts: readonly string[];
  editorModeShortcuts: readonly string[];
  graphActionButtons: readonly string[];
  graphActionShortcuts: readonly string[];
  graphActionIcons: readonly string[];
  codeEditor: boolean;
  graphInspector: boolean;
  graphFilterShortcut: string;
  status: string;
  selectionFocusLabel: string;
  selectionFocusShortcut: string;
  selectionFocusVisible: boolean;
}

export function verifyHealth(health: AppHealthDiagnostics, errors: string[]): void {
  if (!health.ready) errors.push("app health did not report ready");
  if (!health.editorReady) errors.push("code editor was not ready");
  if (!health.graphReady) errors.push("graph inspector was not ready");
  if (!health.activeSdfReady) errors.push("active SDF was not ready");
  if (!health.healthCheckMode) errors.push("app health iframe did not run in health-check mode");
  if (health.dirty) errors.push("health-check app unexpectedly reported dirty state");
  if (health.sourceCompilePending) errors.push("health-check app unexpectedly had a pending source compile");
  if (!health.sourceValid) errors.push("health-check app did not report valid source");
  if (!health.hasPrettifyButton) errors.push("prettify button missing from app health");
  if (!health.hasLoadButton) errors.push("load button missing from app health");
  if (!health.hasSaveButton) errors.push("save button missing from app health");
  if (!health.workspaceButtons.includes("Load")) errors.push("workspace health missing Load button");
  if (!health.workspaceButtons.includes("Save")) errors.push("workspace health missing Save button");
  if (!health.workspaceButtons.includes("Prettify code")) errors.push("workspace health missing Prettify button");
  verifyWorkspaceButtonShortcuts("health", health.workspaceButtonShortcuts, errors);
  if (health.prettifyShortcut !== "Alt+Shift+F") errors.push(`health prettify shortcut rendered ${health.prettifyShortcut || "nothing"}`);
  if (health.graphFilterShortcut !== "Control+F Meta+F /") {
    errors.push(`health graph filter shortcut rendered ${health.graphFilterShortcut || "nothing"}`);
  }
  verifyEditorModeShortcuts("health", health.editorModeShortcuts, errors);
  if (!health.selectionFocusVisible) errors.push("selection focus button was not visible in app health");
  if (!health.selectionFocusLabel.includes("#")) errors.push(`selection focus label rendered ${health.selectionFocusLabel || "nothing"}`);
  if (health.selectionFocusShortcut !== "Control+Alt+Enter Meta+Alt+Enter") {
    errors.push(`selection focus shortcut rendered ${health.selectionFocusShortcut || "nothing"}`);
  }
  if (!health.graphActionButtons.includes("Undo graph edit")) errors.push("graph action health missing Undo button");
  if (!health.graphActionButtons.includes("Redo graph edit")) errors.push("graph action health missing Redo button");
  if (!health.graphActionButtons.includes("Reset graph edits")) errors.push("graph action health missing Reset button");
  verifyGraphActionShortcuts("health", health.graphActionShortcuts, errors);
  if (health.sourceLinks <= 0) errors.push("app health reported no source links");
  if (health.viewMode !== "shader") errors.push(`initial view mode was ${health.viewMode}`);
  if (health.editorView !== "code") errors.push(`initial editor view was ${health.editorView}`);
  if (health.recursiveDecorationWarnings !== 0) {
    errors.push(`app emitted ${health.recursiveDecorationWarnings} recursive decoration warnings`);
  }
}

export function verifyDom(dom: AppHealthDomSummary, errors: string[]): void {
  if (dom.title !== "sdf browser") errors.push(`app frame title was ${dom.title}`);
  if (!dom.codeEditor) errors.push("app frame had no code editor element");
  if (!dom.graphInspector) errors.push("app frame had no graph inspector element");
  if (dom.graphFilterShortcut !== "Control+F Meta+F /") {
    errors.push(`app frame DOM graph filter shortcut rendered ${dom.graphFilterShortcut || "nothing"}`);
  }
  if (dom.canvasMode !== "glsl-raymarch") errors.push(`app frame canvas mode was ${dom.canvasMode || "missing"}`);
  if (!dom.workspaceButtons.includes("Prettify code")) errors.push("app frame DOM missing Prettify button");
  verifyWorkspaceButtonShortcuts("DOM", dom.workspaceButtonShortcuts, errors);
  verifyEditorModeShortcuts("DOM", dom.editorModeShortcuts, errors);
  if (!dom.selectionFocusVisible) errors.push("app frame DOM selection focus button was hidden");
  if (!dom.selectionFocusLabel.includes("#")) errors.push(`app frame DOM selection focus label rendered ${dom.selectionFocusLabel || "nothing"}`);
  if (dom.selectionFocusShortcut !== "Control+Alt+Enter Meta+Alt+Enter") {
    errors.push(`app frame DOM selection focus shortcut rendered ${dom.selectionFocusShortcut || "nothing"}`);
  }
  if (!dom.graphActionButtons.includes("Undo graph edit")) errors.push("app frame DOM missing Undo graph action");
  if (!dom.graphActionButtons.includes("Redo graph edit")) errors.push("app frame DOM missing Redo graph action");
  if (!dom.graphActionButtons.includes("Reset graph edits")) errors.push("app frame DOM missing Reset graph action");
  verifyGraphActionShortcuts("DOM", dom.graphActionShortcuts, errors);
  for (const icon of ["undo-icon", "redo-icon", "reset-icon"]) {
    if (!dom.graphActionIcons.includes(icon)) errors.push(`app frame DOM missing ${icon}`);
  }
}

export function summarizeFrameDom(frame: HTMLIFrameElement): AppHealthDomSummary {
  const frameDocument = safeFrameDocument(frame);
  return {
    title: frameDocument?.title ?? "",
    canvasMode: frameDocument?.querySelector<HTMLCanvasElement>("#canvas")?.dataset.previewMode ?? "",
    workspaceButtons: Array.from(frameDocument?.querySelectorAll<HTMLButtonElement>(".workspace-bar button") ?? [])
      .filter((button) => !button.hidden)
      .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""),
    workspaceButtonShortcuts: Array.from(frameDocument?.querySelectorAll<HTMLButtonElement>(".workspace-bar button") ?? [])
      .filter((button) => !button.hidden)
      .map((button) => button.getAttribute("aria-keyshortcuts") ?? ""),
    editorModeShortcuts: Array.from(frameDocument?.querySelectorAll<HTMLButtonElement>(".editor-toggle button") ?? [])
      .map((button) => button.getAttribute("aria-keyshortcuts") ?? ""),
    graphActionButtons: Array.from(frameDocument?.querySelectorAll<HTMLButtonElement>(".editor-actions button") ?? [])
      .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""),
    graphActionShortcuts: Array.from(frameDocument?.querySelectorAll<HTMLButtonElement>(".editor-actions button") ?? [])
      .map((button) => button.getAttribute("aria-keyshortcuts") ?? ""),
    graphActionIcons: Array.from(frameDocument?.querySelectorAll<HTMLElement>(".editor-actions button > span[aria-hidden='true']") ?? [])
      .flatMap((icon) => [...icon.classList]),
    codeEditor: Boolean(frameDocument?.querySelector("#codeEditor")),
    graphInspector: Boolean(frameDocument?.querySelector("#graphInspector")),
    graphFilterShortcut: frameDocument?.querySelector(".graph-filter-input")?.getAttribute("aria-keyshortcuts") ?? "",
    status: frameDocument?.querySelector("#editorStatus")?.textContent ?? "",
    selectionFocusLabel: frameDocument?.querySelector("#selectionFocusButton")?.textContent?.trim() ?? "",
    selectionFocusShortcut: frameDocument?.querySelector("#selectionFocusButton")?.getAttribute("aria-keyshortcuts") ?? "",
    selectionFocusVisible: Boolean(frameDocument?.querySelector<HTMLButtonElement>("#selectionFocusButton:not([hidden])")),
  };
}

function verifyGraphActionShortcuts(label: string, shortcuts: readonly string[], errors: string[]): void {
  if (!shortcuts.includes("Control+Z Meta+Z")) {
    errors.push(`${label} graph shortcuts missing undo binding`);
  }
  if (!shortcuts.includes("Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y")) {
    errors.push(`${label} graph shortcuts missing redo binding`);
  }
}

function verifyWorkspaceButtonShortcuts(label: string, shortcuts: readonly string[], errors: string[]): void {
  if (!shortcuts.includes("Control+O Meta+O")) {
    errors.push(`${label} workspace shortcuts missing Load binding`);
  }
  if (!shortcuts.includes("Control+S Meta+S")) {
    errors.push(`${label} workspace shortcuts missing Save binding`);
  }
  if (!shortcuts.includes("Alt+Shift+F")) {
    errors.push(`${label} workspace shortcuts missing Prettify binding`);
  }
}

function verifyEditorModeShortcuts(label: string, shortcuts: readonly string[], errors: string[]): void {
  if (!shortcuts.includes("Control+Alt+1 Meta+Alt+1")) {
    errors.push(`${label} editor mode shortcuts missing Code binding`);
  }
  if (!shortcuts.includes("Control+Alt+2 Meta+Alt+2")) {
    errors.push(`${label} editor mode shortcuts missing Graph binding`);
  }
}
