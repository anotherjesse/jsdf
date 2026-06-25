export interface BrowserSessionCommandResult {
  code?: string;
  sourceValid?: boolean;
  status?: string;
  screenshotDataUrl?: string;
  [key: string]: unknown;
}

export interface BrowserSessionHandlers {
  readStatus(): BrowserSessionCommandResult;
  readCode(): string;
  setCode(code: string, comment: string): Promise<BrowserSessionCommandResult>;
  captureScreenshot(comment: string): Promise<BrowserSessionCommandResult>;
}

export interface BrowserSessionEvents {
  onOpen?(): void;
  onClose?(): void;
  onCommand?(type: string): void;
  onResult?(type: string, result: BrowserSessionCommandResult): void;
  onError?(message: string): void;
}

interface BrowserSessionCommand {
  id: string;
  type: string;
  payload?: {
    code?: string;
    comment?: string;
  };
}

export interface BrowserSessionConnection {
  dispose(): void;
}

const SESSION_PATH_PATTERN = /^\/s\/([1-9A-HJ-NP-Za-km-z]{10})\/?$/;

export function sessionIdFromLocation(location: Location = window.location): string | null {
  return SESSION_PATH_PATTERN.exec(location.pathname)?.[1] ?? null;
}

export function connectBrowserSession(
  sessionId: string,
  handlers: BrowserSessionHandlers,
  events: BrowserSessionEvents = {},
): BrowserSessionConnection {
  const clientId = browserClientId();
  const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events?client=${encodeURIComponent(clientId)}`);
  let disposed = false;

  source.onopen = () => {
    if (!disposed) events.onOpen?.();
  };
  source.onerror = () => {
    if (!disposed) events.onClose?.();
  };
  source.addEventListener("command", (event) => {
    const command = JSON.parse((event as MessageEvent<string>).data) as BrowserSessionCommand;
    void runCommand(sessionId, command, handlers, events);
  });

  return {
    dispose() {
      disposed = true;
      source.close();
    },
  };
}

async function runCommand(
  sessionId: string,
  command: BrowserSessionCommand,
  handlers: BrowserSessionHandlers,
  events: BrowserSessionEvents,
): Promise<void> {
  events.onCommand?.(command.type);
  try {
    const result = await executeCommand(command, handlers);
    await postCommandResult(sessionId, command.id, { ok: true, result });
    events.onResult?.(command.type, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await postCommandResult(sessionId, command.id, { ok: false, error: message });
    events.onError?.(message);
  }
}

async function executeCommand(
  command: BrowserSessionCommand,
  handlers: BrowserSessionHandlers,
): Promise<BrowserSessionCommandResult> {
  const comment = command.payload?.comment ?? "";
  switch (command.type) {
    case "get-status":
      return handlers.readStatus();
    case "get-code":
      return { code: handlers.readCode() };
    case "set-code":
      if (typeof command.payload?.code !== "string") throw new Error("Missing code.");
      return handlers.setCode(command.payload.code, comment);
    case "capture-screenshot":
      return handlers.captureScreenshot(comment);
    default:
      throw new Error(`Unknown session command: ${command.type}`);
  }
}

async function postCommandResult(
  sessionId: string,
  commandId: string,
  body: { ok: true; result: BrowserSessionCommandResult } | { ok: false; error: string },
): Promise<void> {
  await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/results/${encodeURIComponent(commandId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function browserClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
