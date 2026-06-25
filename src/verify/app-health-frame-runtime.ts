import type { AppHealthDiagnostics } from "../editor/app-health";

export interface AppHealthWindow extends Window {
  __sdfAppHealth?: () => AppHealthDiagnostics;
}

export function waitForFrameLoad(frame: HTMLIFrameElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (outcome: "loaded" | "timeout") => {
      cleanup();
      if (outcome === "loaded") resolve();
      else reject(new Error("Timed out waiting for app frame load."));
    };
    const timer = window.setTimeout(() => finish("timeout"), timeoutMs);
    const onLoad = () => finish("loaded");
    const cleanup = () => {
      window.clearTimeout(timer);
      frame.removeEventListener("load", onLoad);
    };
    frame.addEventListener("load", onLoad);
    if (safeFrameDocument(frame)?.readyState === "complete") finish("loaded");
  });
}

export function waitForAppHealth(
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

export function readAppHealth(frame: HTMLIFrameElement): AppHealthDiagnostics | null {
  const frameWindow = safeFrameWindow(frame);
  try {
    return frameWindow?.__sdfAppHealth?.() ?? null;
  } catch {
    return null;
  }
}

export function activeElementToken(document: Document): string {
  const active = document.activeElement;
  if (!active) return "";
  const candidate = active as Element & { id?: string; className?: unknown };
  return candidate.id || String(candidate.className ?? "") || active.tagName;
}

export function selectedGraphNodeHasFocus(document: Document): boolean {
  const active = document.activeElement;
  if (!active || !("classList" in active)) return false;
  if (active.classList.contains("graph-node")) {
    return active.getAttribute("aria-pressed") === "true";
  }
  if (!active.classList.contains("graph-tree")) return false;
  const activeId = active.getAttribute("aria-activedescendant");
  if (!activeId) return false;
  const selected = document.getElementById(activeId);
  return Boolean(
    selected
      && selected.classList.contains("graph-node")
      && selected.getAttribute("aria-pressed") === "true",
  );
}

export function dispatchPointer(target: HTMLElement, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
}

export function dispatchInput(frameWindow: Window, input: HTMLInputElement): void {
  const InputEventCtor = (frameWindow as Window & { InputEvent?: typeof InputEvent }).InputEvent;
  if (InputEventCtor) {
    input.dispatchEvent(new InputEventCtor("input", {
      bubbles: true,
      cancelable: true,
      data: input.value,
      inputType: "insertText",
    }));
    return;
  }
  input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
}

export function nextFrame(frameWindow: Window): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = frameWindow.setTimeout(done, 50);
    function done(): void {
      if (settled) return;
      settled = true;
      frameWindow.clearTimeout(timeout);
      resolve();
    }
    frameWindow.requestAnimationFrame(done);
  });
}

export async function settleFrame(frameWindow: Window): Promise<void> {
  await nextFrame(frameWindow);
  await new Promise((resolve) => frameWindow.setTimeout(resolve, 80));
  await nextFrame(frameWindow);
}

export function safeFrameWindow(frame: HTMLIFrameElement): AppHealthWindow | null {
  try {
    return frame.contentWindow as AppHealthWindow | null;
  } catch {
    return null;
  }
}

export function safeFrameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}
