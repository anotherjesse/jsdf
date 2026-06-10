import type { AppHealthDiagnostics } from "../editor/app-health";

export interface AppHealthRuntimeVerification {
  ok: boolean;
  loadMs: number;
  health: AppHealthDiagnostics | null;
  dom: {
    title: string;
    canvasMode: string;
    workspaceButtons: readonly string[];
    codeEditor: boolean;
    graphInspector: boolean;
    status: string;
  };
  graphHoverStatus: {
    before: string;
    during: string;
    after: string;
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
