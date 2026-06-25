export interface AppHealthDiagnostics {
  ready: boolean;
  editorReady: boolean;
  graphReady: boolean;
  activeSdfReady: boolean;
  healthCheckMode: boolean;
  dirty: boolean;
  status: string;
  sourceCompilePending: boolean;
  sourceValid: boolean;
  viewMode: string;
  editorView: string;
  previewLayout: string;
  meshAlgorithm: string;
  sourceLinks: number;
  selectedNode: string | null;
  selectedSourceLink: string | null;
  selectionFocusLabel: string;
  selectionFocusShortcut: string;
  selectionFocusVisible: boolean;
  sourceRevealedDecorations: number;
  hiddenNodes: number;
  meshTriangles: number | null;
  meshBuildPending: boolean;
  hasPrettifyButton: boolean;
  hasLoadButton: boolean;
  hasSaveButton: boolean;
  workspaceButtons: readonly string[];
  workspaceButtonShortcuts: readonly string[];
  prettifyShortcut: string;
  graphFilterShortcut: string;
  editorModeShortcuts: readonly string[];
  graphActionButtons: readonly string[];
  graphActionShortcuts: readonly string[];
  recursiveDecorationWarnings: number;
  lastRecursiveDecorationMessage: string | null;
}

export interface AppHealthMonitor {
  readonly recursiveDecorationWarnings: number;
  readonly lastRecursiveDecorationMessage: string | null;
}

export interface AppHealthDiagnosticsState {
  ready: boolean;
  editorReady: boolean;
  graphReady: boolean;
  activeSdfReady: boolean;
  healthCheckMode: boolean;
  dirty: boolean;
  status: string;
  sourceCompilePending: boolean;
  sourceValid: boolean;
  viewMode: string;
  editorView: string;
  previewLayout: string;
  meshAlgorithm: string;
  sourceLinks: number;
  selectedNode: string | null;
  selectedSourceLink: string | null;
  sourceRevealedDecorations: number;
  hiddenNodes: number;
  meshTriangles: number | null;
  meshBuildPending: boolean;
}

export interface AppHealthDiagnosticsElements {
  selectionFocusButton: HTMLButtonElement;
  prettifySourceButton: HTMLButtonElement;
  loadSourceButton: HTMLButtonElement;
  saveSourceButton: HTMLButtonElement;
}

export interface AppHealthDiagnosticsShortcuts {
  prettify: string;
  graphFilter: string;
}

export interface AppHealthDiagnosticsReaderOptions {
  monitor: AppHealthMonitor;
  elements: AppHealthDiagnosticsElements;
  shortcuts: AppHealthDiagnosticsShortcuts;
  readState(): AppHealthDiagnosticsState;
}

type ConsoleMethod = (...args: unknown[]) => void;

interface AppHealthGlobal {
  __sdfAppHealth?: () => AppHealthDiagnostics;
  __sdfAppHealthMonitor?: MutableAppHealthMonitor;
}

interface MutableAppHealthMonitor extends AppHealthMonitor {
  recursiveDecorationWarnings: number;
  lastRecursiveDecorationMessage: string | null;
  originalWarn: ConsoleMethod;
  originalError: ConsoleMethod;
}

const RECURSIVE_DECORATION_MESSAGE = "Invoking deltaDecorations recursively";

export function installAppHealthMonitor(): AppHealthMonitor {
  const target = globalThis as typeof globalThis & AppHealthGlobal;
  if (target.__sdfAppHealthMonitor) return target.__sdfAppHealthMonitor;

  const monitor: MutableAppHealthMonitor = {
    recursiveDecorationWarnings: 0,
    lastRecursiveDecorationMessage: null,
    originalWarn: console.warn.bind(console),
    originalError: console.error.bind(console),
  };

  console.warn = (...args: unknown[]) => {
    captureRecursiveDecorationMessage(monitor, args);
    monitor.originalWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    captureRecursiveDecorationMessage(monitor, args);
    monitor.originalError(...args);
  };

  target.__sdfAppHealthMonitor = monitor;
  return monitor;
}

export function exposeAppHealthDiagnostics(read: () => AppHealthDiagnostics): void {
  const target = globalThis as typeof globalThis & AppHealthGlobal;
  target.__sdfAppHealth = read;
}

export function createAppHealthDiagnosticsReader(
  options: AppHealthDiagnosticsReaderOptions,
): () => AppHealthDiagnostics {
  const { elements, monitor, shortcuts } = options;
  return () => {
    const state = options.readState();
    return {
      ...state,
      selectionFocusLabel: elements.selectionFocusButton.textContent?.trim() ?? "",
      selectionFocusShortcut: elements.selectionFocusButton.getAttribute("aria-keyshortcuts") ?? "",
      selectionFocusVisible: !elements.selectionFocusButton.hidden,
      hasPrettifyButton: Boolean(elements.prettifySourceButton),
      hasLoadButton: Boolean(elements.loadSourceButton),
      hasSaveButton: Boolean(elements.saveSourceButton),
      workspaceButtons: buttonLabels(".workspace-bar button"),
      workspaceButtonShortcuts: buttonShortcuts(".workspace-bar button"),
      prettifyShortcut: shortcuts.prettify,
      graphFilterShortcut: shortcuts.graphFilter,
      editorModeShortcuts: buttonShortcuts(".editor-toggle button"),
      graphActionButtons: buttonLabels(".editor-actions button"),
      graphActionShortcuts: buttonShortcuts(".editor-actions button"),
      recursiveDecorationWarnings: monitor.recursiveDecorationWarnings,
      lastRecursiveDecorationMessage: monitor.lastRecursiveDecorationMessage,
    };
  };
}

function captureRecursiveDecorationMessage(monitor: MutableAppHealthMonitor, args: readonly unknown[]): void {
  const message = args.map((arg) => String(arg)).join(" ");
  if (!message.includes(RECURSIVE_DECORATION_MESSAGE)) return;
  monitor.recursiveDecorationWarnings += 1;
  monitor.lastRecursiveDecorationMessage = message;
}

function buttonLabels(selector: string): readonly string[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
    .filter((button) => !button.hidden)
    .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "");
}

function buttonShortcuts(selector: string): readonly string[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
    .filter((button) => !button.hidden)
    .map((button) => button.getAttribute("aria-keyshortcuts") ?? "");
}
