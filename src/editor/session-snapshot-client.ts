import type { BrowserSessionCommandResult } from "./browser-session";

export interface SessionSnapshot {
  id: string;
  createdAt?: string;
  kind?: string;
  comment?: string;
  sourceValid?: boolean;
  status?: string;
  codeUrl?: string | null;
  screenshotUrl?: string | null;
  restoredSnapshotId?: string | null;
}

export interface SessionSnapshotListResponse {
  snapshots?: SessionSnapshot[];
}

export interface SessionSnapshotWriteResponse {
  ok?: boolean;
  snapshot?: SessionSnapshot;
  restoredSnapshot?: SessionSnapshot;
  sourceValid?: boolean;
  status?: string;
}

export type SessionSnapshotPayload = BrowserSessionCommandResult & {
  kind?: string;
  comment?: string;
};

export async function listSessionSnapshots(sessionId: string): Promise<SessionSnapshot[]> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/snapshots`, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  const body = await response.json() as SessionSnapshotListResponse;
  return (body.snapshots ?? []).filter(isSessionSnapshot);
}

export async function createSessionSnapshot(
  sessionId: string,
  payload: SessionSnapshotPayload,
): Promise<SessionSnapshotWriteResponse> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/snapshots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<SessionSnapshotWriteResponse>;
}

export async function restoreSessionSnapshot(
  sessionId: string,
  snapshotId: string,
  comment: string,
  clientId: string | null = null,
): Promise<SessionSnapshotWriteResponse> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        comment,
        ...(clientId ? { clientId } : {}),
      }),
    },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<SessionSnapshotWriteResponse>;
}

export async function readSessionSnapshotCode(snapshot: SessionSnapshot | null): Promise<string | null> {
  if (!snapshot?.codeUrl) return null;
  const response = await fetch(snapshot.codeUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return response.text();
}

function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<SessionSnapshot>;
  return typeof snapshot.id === "string";
}
