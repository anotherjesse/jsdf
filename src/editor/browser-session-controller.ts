import {
  connectBrowserSession,
  type BrowserSessionCommandResult,
  type BrowserSessionConnection,
} from "./browser-session";
import { createSessionSnapshot, listSessionSnapshots } from "./session-snapshot-client";

type BrowserSessionStatusState = "idle" | "ok" | "pending" | "error";

export interface BrowserSessionControllerElements {
  strip: HTMLElement;
  idLabel: HTMLElement;
  copyAgentPromptButton: HTMLButtonElement;
  snapshotButton: HTMLButtonElement;
  status: HTMLElement;
}

export interface BrowserSessionControllerOptions {
  sessionId: string | null;
  elements: BrowserSessionControllerElements;
  readStatus(): BrowserSessionCommandResult;
  readCode(): string;
  setCode(code: string, comment: string): Promise<BrowserSessionCommandResult>;
  captureScreenshot(comment: string): Promise<BrowserSessionCommandResult>;
  captureSnapshotState(): Promise<BrowserSessionCommandResult>;
  onSnapshotsChanged?(): void | Promise<void>;
}

export interface BrowserSessionController {
  configure(): void;
  connect(): void;
  dispose(): void;
  refreshSnapshotCount(): Promise<void>;
  currentClientId(): string | null;
}

export function createBrowserSessionController(options: BrowserSessionControllerOptions): BrowserSessionController {
  let connection: BrowserSessionConnection | null = null;
  let configured = false;
  const { elements, sessionId } = options;

  const setStatus = (message: string, state: BrowserSessionStatusState) => {
    elements.status.textContent = message;
    elements.status.dataset.state = state;
    elements.status.title = message;
  };

  const refreshSnapshotCount = async () => {
    if (!sessionId) return;
    try {
      const count = (await listSessionSnapshots(sessionId)).length;
      if (count > 0 && elements.status.textContent && !elements.status.textContent.includes("snapshot")) {
        elements.status.title = `${count} snapshot${count === 1 ? "" : "s"}`;
      }
    } catch {
      // Snapshot count is informational; connection state stays more important.
    }
  };

  const copyAgentPrompt = async () => {
    if (!sessionId) return;
    const prompt = [
      "Join my sdf browser session. Fetch the connection instructions and follow them:",
      "",
      `curl -s ${window.location.origin}/api/sessions/${sessionId}/connect.md`,
      "",
      "That URL identifies my local session.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("Copied agent prompt", "ok");
    } catch {
      setStatus("Copy failed", "error");
    }
  };

  const createManualSnapshot = async () => {
    if (!sessionId) return;
    const comment = window.prompt("Snapshot comment", "");
    if (comment == null) return;

    elements.snapshotButton.disabled = true;
    try {
      const state = await options.captureSnapshotState();
      const saved = await createSessionSnapshot(sessionId, {
        ...state,
        kind: "manual",
        comment: comment.trim(),
      });
      setStatus(saved.snapshot?.id ? `Snapshot ${saved.snapshot.id}` : "Snapshot saved", "ok");
      await refreshSnapshotCount();
      await options.onSnapshotsChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      elements.snapshotButton.disabled = false;
    }
  };

  const refreshSnapshotsChanged = async () => {
    await refreshSnapshotCount();
    await options.onSnapshotsChanged?.();
  };

  return {
    configure() {
      if (!sessionId) {
        elements.strip.hidden = true;
        return;
      }
      if (configured) return;
      configured = true;
      elements.strip.hidden = false;
      elements.idLabel.textContent = sessionId;
      elements.status.textContent = "Connecting";
      elements.copyAgentPromptButton.addEventListener("click", copyAgentPrompt);
      elements.snapshotButton.addEventListener("click", () => void createManualSnapshot());
      void refreshSnapshotCount();
    },
    connect() {
      if (!sessionId || connection) return;
      connection = connectBrowserSession(sessionId, {
        readStatus: options.readStatus,
        readCode: options.readCode,
        setCode: options.setCode,
        captureScreenshot: options.captureScreenshot,
      }, {
        onOpen: () => setStatus("Connected", "ok"),
        onClose: () => setStatus("Reconnecting", "pending"),
        onCommand: (type) => setStatus(sessionCommandLabel(type), "pending"),
        onResult: (type) => {
          setStatus(`${sessionCommandLabel(type)} done`, "ok");
        },
        onSnapshot: () => void refreshSnapshotsChanged(),
        onError: (message) => setStatus(message, "error"),
      });
    },
    dispose() {
      connection?.dispose();
      connection = null;
    },
    refreshSnapshotCount,
    currentClientId() {
      return connection?.clientId ?? null;
    },
  };
}

function sessionCommandLabel(type: string): string {
  switch (type) {
    case "get-status":
      return "Status";
    case "get-code":
      return "Code read";
    case "set-code":
      return "Code update";
    case "capture-screenshot":
      return "Screenshot";
    default:
      return "Agent command";
  }
}
