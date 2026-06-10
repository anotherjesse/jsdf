import type { AppHealthDiagnostics } from "../editor/app-health";

export interface AppHealthRuntimeVerification {
  ok: boolean;
  loadMs: number;
  health: AppHealthDiagnostics | null;
  dom: {
    title: string;
    canvasMode: string;
    workspaceButtons: readonly string[];
    graphActionButtons: readonly string[];
    graphActionShortcuts: readonly string[];
    graphActionIcons: readonly string[];
    codeEditor: boolean;
    graphInspector: boolean;
    status: string;
  };
  graphHoverStatus: {
    before: string;
    during: string;
    after: string;
  };
  sourceDialogFocus: {
    loadShortcut: string;
    shortcutPreventedDefault: boolean;
    onOpen: string;
    afterClose: string;
  };
  graphCodeReveal: {
    selectedBefore: string;
    selectedAfter: string;
    editorView: string;
    revealedMarks: number;
    codeVisible: boolean;
  };
  codeGraphReveal: {
    selectedBefore: string;
    selectedAfter: string;
    editorView: string;
    graphVisible: boolean;
    activeElement: string;
    focusedSelectedNode: boolean;
  };
  errors: string[];
}

interface AppHealthWindow extends Window {
  __sdfAppHealth?: () => AppHealthDiagnostics;
}

const APP_HEALTH_TIMEOUT_MS = 20_000;

export async function runAppHealthRuntimeVerification(
  frame: HTMLIFrameElement,
): Promise<AppHealthRuntimeVerification> {
  const errors: string[] = [];
  const start = performance.now();
  frame.src = `./?app-health-check=${Date.now()}`;
  await waitForFrameLoad(frame, APP_HEALTH_TIMEOUT_MS);
  const health = await waitForAppHealth(frame, APP_HEALTH_TIMEOUT_MS);
  const loadMs = performance.now() - start;
  const dom = summarizeFrameDom(frame);
  const graphHoverStatus = await verifyGraphHoverKeepsStatus(frame, errors);
  const sourceDialogFocus = await verifySourceDialogFocus(frame, errors);
  const graphCodeReveal = await verifyGraphCodeReveal(frame, errors);
  const codeGraphReveal = await verifyCodeGraphReveal(frame, errors);

  if (!health) {
    errors.push("app health hook never became available");
  } else {
    verifyHealth(health, errors);
  }
  verifyDom(dom, errors);

  return {
    ok: errors.length === 0,
    loadMs,
    health,
    dom,
    graphHoverStatus,
    sourceDialogFocus,
    graphCodeReveal,
    codeGraphReveal,
    errors,
  };
}

function verifyHealth(health: AppHealthDiagnostics, errors: string[]): void {
  if (!health.ready) errors.push("app health did not report ready");
  if (!health.editorReady) errors.push("code editor was not ready");
  if (!health.graphReady) errors.push("graph inspector was not ready");
  if (!health.activeSdfReady) errors.push("active SDF was not ready");
  if (!health.healthCheckMode) errors.push("app health iframe did not run in health-check mode");
  if (health.dirty) errors.push("health-check app unexpectedly reported dirty state");
  if (!health.hasPrettifyButton) errors.push("prettify button missing from app health");
  if (!health.hasLoadButton) errors.push("load button missing from app health");
  if (!health.hasSaveButton) errors.push("save button missing from app health");
  if (!health.workspaceButtons.includes("Load")) errors.push("workspace health missing Load button");
  if (!health.workspaceButtons.includes("Save")) errors.push("workspace health missing Save button");
  if (!health.workspaceButtons.includes("Prettify code")) errors.push("workspace health missing Prettify button");
  if (!health.workspaceButtons.includes("Toggle graph hints")) errors.push("workspace health missing Hints button");
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

function verifyDom(dom: AppHealthRuntimeVerification["dom"], errors: string[]): void {
  if (dom.title !== "sdf browser") errors.push(`app frame title was ${dom.title}`);
  if (!dom.codeEditor) errors.push("app frame had no code editor element");
  if (!dom.graphInspector) errors.push("app frame had no graph inspector element");
  if (dom.canvasMode !== "glsl-raymarch") errors.push(`app frame canvas mode was ${dom.canvasMode || "missing"}`);
  if (!dom.workspaceButtons.includes("Prettify code")) errors.push("app frame DOM missing Prettify button");
  if (!dom.workspaceButtons.includes("Toggle graph hints")) errors.push("app frame DOM missing Hints button");
  if (!dom.graphActionButtons.includes("Undo graph edit")) errors.push("app frame DOM missing Undo graph action");
  if (!dom.graphActionButtons.includes("Redo graph edit")) errors.push("app frame DOM missing Redo graph action");
  if (!dom.graphActionButtons.includes("Reset graph edits")) errors.push("app frame DOM missing Reset graph action");
  verifyGraphActionShortcuts("DOM", dom.graphActionShortcuts, errors);
  for (const icon of ["undo-icon", "redo-icon", "reset-icon"]) {
    if (!dom.graphActionIcons.includes(icon)) errors.push(`app frame DOM missing ${icon}`);
  }
}

function verifyGraphActionShortcuts(label: string, shortcuts: readonly string[], errors: string[]): void {
  if (!shortcuts.includes("Control+Z Meta+Z")) {
    errors.push(`${label} graph shortcuts missing undo binding`);
  }
  if (!shortcuts.includes("Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y")) {
    errors.push(`${label} graph shortcuts missing redo binding`);
  }
}

function waitForFrameLoad(frame: HTMLIFrameElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const documentReady = safeFrameDocument(frame)?.readyState;
      if (documentReady === "complete") {
        cleanup();
        resolve();
      } else if (performance.now() - startedAt > timeoutMs) {
        cleanup();
        reject(new Error("Timed out waiting for app frame load."));
      }
    }, 50);
    const cleanup = () => window.clearInterval(timer);
  });
}

function waitForAppHealth(
  frame: HTMLIFrameElement,
  timeoutMs: number,
): Promise<AppHealthDiagnostics | null> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const health = readAppHealth(frame);
      if (health?.ready || performance.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        resolve(health);
      }
    }, 80);
  });
}

function readAppHealth(frame: HTMLIFrameElement): AppHealthDiagnostics | null {
  const frameWindow = safeFrameWindow(frame);
  try {
    return frameWindow?.__sdfAppHealth?.() ?? null;
  } catch {
    return null;
  }
}

function summarizeFrameDom(frame: HTMLIFrameElement): AppHealthRuntimeVerification["dom"] {
  const frameDocument = safeFrameDocument(frame);
  return {
    title: frameDocument?.title ?? "",
    canvasMode: frameDocument?.querySelector<HTMLCanvasElement>("#canvas")?.dataset.previewMode ?? "",
    workspaceButtons: Array.from(frameDocument?.querySelectorAll<HTMLButtonElement>(".workspace-bar button") ?? [])
      .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""),
    graphActionButtons: Array.from(frameDocument?.querySelectorAll<HTMLButtonElement>(".editor-actions button") ?? [])
      .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""),
    graphActionShortcuts: Array.from(frameDocument?.querySelectorAll<HTMLButtonElement>(".editor-actions button") ?? [])
      .map((button) => button.getAttribute("aria-keyshortcuts") ?? ""),
    graphActionIcons: Array.from(frameDocument?.querySelectorAll<HTMLElement>(".editor-actions button > span[aria-hidden='true']") ?? [])
      .flatMap((icon) => [...icon.classList]),
    codeEditor: Boolean(frameDocument?.querySelector("#codeEditor")),
    graphInspector: Boolean(frameDocument?.querySelector("#graphInspector")),
    status: frameDocument?.querySelector("#editorStatus")?.textContent ?? "",
  };
}

async function verifyGraphHoverKeepsStatus(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["graphHoverStatus"]> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = { before: "", during: "", after: "" };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for graph hover status verification");
    return empty;
  }

  const graphMode = frameDocument.querySelector<HTMLButtonElement>("#graphModeButton");
  const status = frameDocument.querySelector<HTMLElement>("#editorStatus");
  if (!graphMode || !status) {
    errors.push("app frame missing graph mode button or editor status");
    return empty;
  }

  graphMode.click();
  await nextFrame(frameWindow);

  const graphNodes = Array.from(frameDocument.querySelectorAll<HTMLElement>(".graph-node[data-node-id]"));
  const target = graphNodes.find((node) => node.getAttribute("aria-pressed") !== "true") ?? graphNodes[0] ?? null;
  if (!target) {
    errors.push("app frame had no graph node to hover");
    return empty;
  }

  const before = status.textContent ?? "";
  dispatchPointer(target, "pointerenter");
  dispatchPointer(target, "pointermove");
  await nextFrame(frameWindow);
  const during = status.textContent ?? "";
  dispatchPointer(target, "pointerleave");
  await nextFrame(frameWindow);
  const after = status.textContent ?? "";

  if (during !== before) {
    errors.push(`graph hover changed editor status from "${before}" to "${during}"`);
  }
  if (after !== before) {
    errors.push(`graph hover leave changed editor status from "${before}" to "${after}"`);
  }

  return { before, during, after };
}

async function verifySourceDialogFocus(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["sourceDialogFocus"]> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = { loadShortcut: "", shortcutPreventedDefault: false, onOpen: "", afterClose: "" };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for source dialog focus verification");
    return empty;
  }

  const loadButton = frameDocument.querySelector<HTMLButtonElement>("#loadSourceButton");
  const closeButton = frameDocument.querySelector<HTMLButtonElement>("#closeSourceDialogButton");
  if (!loadButton || !closeButton) {
    errors.push("app frame missing source dialog focus controls");
    return empty;
  }

  const loadShortcut = loadButton.getAttribute("aria-keyshortcuts") ?? "";
  if (!loadShortcut.includes("Control+O") || !loadShortcut.includes("Meta+O")) {
    errors.push(`load button advertised shortcut as ${loadShortcut || "nothing"}`);
  }

  const KeyboardEventCtor = (frameWindow as AppHealthWindow & { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  const shortcutPreventedDefault = !frameWindow.dispatchEvent(new KeyboardEventCtor("keydown", {
    key: "o",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }));
  if (!shortcutPreventedDefault) {
    errors.push("load shortcut did not prevent the browser default");
  }
  await nextFrame(frameWindow);
  await nextFrame(frameWindow);
  const onOpen = activeElementToken(frameDocument);
  if (onOpen !== "source-search-input") {
    errors.push(`source dialog focused ${onOpen || "nothing"} on open`);
  }

  closeButton.click();
  await nextFrame(frameWindow);
  const afterClose = activeElementToken(frameDocument);
  if (afterClose !== "loadSourceButton") {
    errors.push(`source dialog restored focus to ${afterClose || "nothing"}`);
  }

  return { loadShortcut, shortcutPreventedDefault, onOpen, afterClose };
}

async function verifyGraphCodeReveal(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["graphCodeReveal"]> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = { selectedBefore: "", selectedAfter: "", editorView: "", revealedMarks: 0, codeVisible: false };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for graph-to-code reveal verification");
    return empty;
  }

  const graphMode = frameDocument.querySelector<HTMLButtonElement>("#graphModeButton");
  const codeMode = frameDocument.querySelector<HTMLButtonElement>("#codeModeButton");
  const codePanel = frameDocument.querySelector<HTMLElement>("#codePanel");
  if (!graphMode || !codeMode || !codePanel) {
    errors.push("app frame missing graph-to-code reveal controls");
    return empty;
  }

  graphMode.click();
  await nextFrame(frameWindow);
  const graphNodes = Array.from(frameDocument.querySelectorAll<HTMLButtonElement>(".graph-node[data-node-id]"));
  const target = graphNodes.find((node) => node.getAttribute("aria-pressed") !== "true") ?? graphNodes[0] ?? null;
  if (!target) {
    errors.push("app frame had no graph node for code reveal");
    return empty;
  }

  target.click();
  await nextFrame(frameWindow);
  const selectedBefore = readAppHealth(frame)?.selectedSourceLink ?? "";
  if (!selectedBefore) {
    errors.push("graph node selection did not produce a selected source link");
  }

  codeMode.click();
  await nextFrame(frameWindow);
  await nextFrame(frameWindow);
  const afterHealth = readAppHealth(frame);
  const selectedAfter = afterHealth?.selectedSourceLink ?? "";
  const editorView = afterHealth?.editorView ?? "";
  const revealedMarks = frameDocument.querySelectorAll("#codeEditor .source-revealed-link").length;
  const codeVisible = !codePanel.classList.contains("hidden");

  if (editorView !== "code") errors.push(`graph-to-code reveal left editor in ${editorView || "unknown"} view`);
  if (!codeVisible) errors.push("graph-to-code reveal left code panel hidden");
  if (selectedAfter !== selectedBefore) {
    errors.push(`graph-to-code reveal changed selected link from ${selectedBefore || "nothing"} to ${selectedAfter || "nothing"}`);
  }
  if (revealedMarks < 1) {
    errors.push("graph-to-code reveal did not mark the selected source range");
  }

  return { selectedBefore, selectedAfter, editorView, revealedMarks, codeVisible };
}

async function verifyCodeGraphReveal(
  frame: HTMLIFrameElement,
  errors: string[],
): Promise<AppHealthRuntimeVerification["codeGraphReveal"]> {
  const frameDocument = safeFrameDocument(frame);
  const frameWindow = safeFrameWindow(frame);
  const empty = {
    selectedBefore: "",
    selectedAfter: "",
    editorView: "",
    graphVisible: false,
    activeElement: "",
    focusedSelectedNode: false,
  };
  if (!frameDocument || !frameWindow) {
    errors.push("app frame was unavailable for code-to-graph reveal verification");
    return empty;
  }

  const graphMode = frameDocument.querySelector<HTMLButtonElement>("#graphModeButton");
  const graphPanel = frameDocument.querySelector<HTMLElement>("#graphPanel");
  if (!graphMode || !graphPanel) {
    errors.push("app frame missing code-to-graph reveal controls");
    return empty;
  }

  const selectedBefore = readAppHealth(frame)?.selectedNode ?? "";
  if (!selectedBefore) {
    errors.push("code-to-graph reveal started without a selected graph node");
  }

  graphMode.click();
  await nextFrame(frameWindow);
  await nextFrame(frameWindow);
  await nextFrame(frameWindow);
  const afterHealth = readAppHealth(frame);
  const selectedAfter = afterHealth?.selectedNode ?? "";
  const editorView = afterHealth?.editorView ?? "";
  const graphVisible = !graphPanel.classList.contains("hidden");
  const activeElement = activeElementToken(frameDocument);
  const active = frameDocument.activeElement;
  const focusedSelectedNode = Boolean(
    active
      && "classList" in active
      && active.classList.contains("graph-node")
      && active.getAttribute("aria-pressed") === "true",
  );

  if (editorView !== "graph") errors.push(`code-to-graph reveal left editor in ${editorView || "unknown"} view`);
  if (!graphVisible) errors.push("code-to-graph reveal left graph panel hidden");
  if (selectedAfter !== selectedBefore) {
    errors.push(`code-to-graph reveal changed selected node from ${selectedBefore || "nothing"} to ${selectedAfter || "nothing"}`);
  }
  if (!focusedSelectedNode) {
    errors.push(`code-to-graph reveal focused ${activeElement || "nothing"} instead of the selected graph node`);
  }

  return { selectedBefore, selectedAfter, editorView, graphVisible, activeElement, focusedSelectedNode };
}

function activeElementToken(document: Document): string {
  const active = document.activeElement;
  if (!active) return "";
  const candidate = active as Element & { id?: string; className?: unknown };
  return candidate.id || String(candidate.className ?? "") || active.tagName;
}

function dispatchPointer(target: HTMLElement, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
}

function nextFrame(frameWindow: Window): Promise<void> {
  return new Promise((resolve) => frameWindow.requestAnimationFrame(() => resolve()));
}

function safeFrameWindow(frame: HTMLIFrameElement): AppHealthWindow | null {
  try {
    return frame.contentWindow as AppHealthWindow | null;
  } catch {
    return null;
  }
}

function safeFrameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}
