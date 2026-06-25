import type { PreviewViewportController } from "../preview/preview-viewport-controller";
import type { AppHealthDiagnostics } from "./app-health";
import { waitForBrowserFrame } from "./app-frame";
import {
  sessionIdFromLocation,
  type BrowserSessionCommandResult,
} from "./browser-session";
import {
  createBrowserSessionController,
  type BrowserSessionController,
  type BrowserSessionControllerElements,
} from "./browser-session-controller";
import type { CodeEditor } from "./code-editor";

export interface BrowserSessionBridgeOptions {
  elements: BrowserSessionControllerElements;
  canvas: HTMLCanvasElement;
  editorStatus: HTMLElement;
  previewViewport: PreviewViewportController;
  codeEditor(): CodeEditor | null;
  readDiagnostics(): AppHealthDiagnostics;
  currentDocumentName(): string;
  currentSource(): string;
  sourceValid(): boolean;
  clearPendingCompile(): void;
  preserveHiddenNodeKeys(): void;
  updateSaveState(): void;
  compileAgentUpdate(): void;
}

export function createBrowserSessionBridge(options: BrowserSessionBridgeOptions): BrowserSessionController {
  const sessionId = sessionIdFromLocation();

  async function captureBrowserSessionState(): Promise<BrowserSessionCommandResult> {
    await options.previewViewport.renderShaderPreviewForSession(options.sourceValid(), waitForBrowserFrame);
    return {
      code: options.currentSource(),
      sourceValid: options.sourceValid(),
      status: options.editorStatus.textContent ?? "",
      viewMode: options.previewViewport.viewMode,
      previewLayout: options.previewViewport.previewLayout,
      screenshotDataUrl: options.canvas.toDataURL("image/png"),
    };
  }

  async function applyBrowserSessionCode(code: string): Promise<BrowserSessionCommandResult> {
    options.clearPendingCompile();
    options.preserveHiddenNodeKeys();
    options.codeEditor()?.setValue(code);
    options.updateSaveState();
    options.compileAgentUpdate();
    return captureBrowserSessionState();
  }

  return createBrowserSessionController({
    sessionId,
    elements: options.elements,
    readStatus: () => ({
      ...options.readDiagnostics(),
      sessionId,
      documentName: options.currentDocumentName(),
    }),
    readCode: options.currentSource,
    setCode: applyBrowserSessionCode,
    captureScreenshot: captureBrowserSessionState,
    captureSnapshotState: captureBrowserSessionState,
  });
}
