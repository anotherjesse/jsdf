import {
  connectBrowserSession,
  type BrowserSessionCommandResult,
  type BrowserSessionConnection,
} from "./browser-session";

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
}

export interface BrowserSessionController {
  configure(): void;
  connect(): void;
  dispose(): void;
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
      const response = await fetch(`/api/sessions/${sessionId}/snapshots`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { snapshots?: unknown[] };
      const count = body.snapshots?.length ?? 0;
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
      const response = await fetch(`/api/sessions/${sessionId}/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...state,
          kind: "manual",
          comment: comment.trim(),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const saved = await response.json() as { snapshot?: { id?: string } };
      setStatus(saved.snapshot?.id ? `Snapshot ${saved.snapshot.id}` : "Snapshot saved", "ok");
      await refreshSnapshotCount();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      elements.snapshotButton.disabled = false;
    }
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
          void refreshSnapshotCount();
        },
        onError: (message) => setStatus(message, "error"),
      });
    },
    dispose() {
      connection?.dispose();
      connection = null;
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
