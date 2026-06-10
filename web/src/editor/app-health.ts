export interface AppHealthDiagnostics {
  ready: boolean;
  editorReady: boolean;
  graphReady: boolean;
  activeSdfReady: boolean;
  healthCheckMode: boolean;
  dirty: boolean;
  status: string;
  viewMode: string;
  editorView: string;
  previewLayout: string;
  meshAlgorithm: string;
  sourceLinks: number;
  selectedNode: string | null;
  selectedSourceLink: string | null;
  hiddenNodes: number;
  meshTriangles: number | null;
  meshBuildPending: boolean;
  hasPrettifyButton: boolean;
  hasLoadButton: boolean;
  hasSaveButton: boolean;
  workspaceButtons: readonly string[];
  graphActionButtons: readonly string[];
  recursiveDecorationWarnings: number;
  lastRecursiveDecorationMessage: string | null;
}

export interface AppHealthMonitor {
  readonly recursiveDecorationWarnings: number;
  readonly lastRecursiveDecorationMessage: string | null;
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

function captureRecursiveDecorationMessage(monitor: MutableAppHealthMonitor, args: readonly unknown[]): void {
  const message = args.map((arg) => String(arg)).join(" ");
  if (!message.includes(RECURSIVE_DECORATION_MESSAGE)) return;
  monitor.recursiveDecorationWarnings += 1;
  monitor.lastRecursiveDecorationMessage = message;
}
