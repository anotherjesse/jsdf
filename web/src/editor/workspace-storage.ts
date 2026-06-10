export interface SavedSourceVersion {
  id: string;
  createdAt: string;
  source: string;
}

export interface SavedSourceDocument {
  id: string;
  name: string;
  updatedAt: string;
  versions: SavedSourceVersion[];
}

interface SavedWorkspaceState {
  documents: SavedSourceDocument[];
}

const STORAGE_KEY = "sdf-browser-workspace-v1";

export function listSavedSourceDocuments(storage = globalThis.localStorage): SavedSourceDocument[] {
  return readState(storage).documents
    .map(normalizeDocument)
    .filter((doc): doc is SavedSourceDocument => doc != null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function latestSourceVersion(doc: SavedSourceDocument): SavedSourceVersion | null {
  return [...doc.versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export function loadSavedSourceVersion(
  docId: string,
  versionId: string | null = null,
  storage = globalThis.localStorage,
): { document: SavedSourceDocument; version: SavedSourceVersion } | null {
  const document = listSavedSourceDocuments(storage).find((doc) => doc.id === docId);
  if (!document) return null;
  const version = versionId
    ? document.versions.find((candidate) => candidate.id === versionId)
    : latestSourceVersion(document);
  return version ? { document, version } : null;
}

export function saveSourceVersion(
  name: string,
  source: string,
  documentId: string | null = null,
  storage = globalThis.localStorage,
): SavedSourceDocument {
  const state = readState(storage);
  const now = new Date().toISOString();
  const trimmedName = name.trim() || "Untitled SDF";
  let document = documentId ? state.documents.find((doc) => doc.id === documentId) : undefined;

  if (!document) {
    document = {
      id: createId("doc"),
      name: trimmedName,
      updatedAt: now,
      versions: [],
    };
    state.documents.push(document);
  }

  document.name = trimmedName;
  document.updatedAt = now;
  document.versions.push({
    id: createId("version"),
    createdAt: now,
    source,
  });
  writeState(storage, state);
  return normalizeDocument(document) ?? document;
}

function readState(storage: Storage): SavedWorkspaceState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { documents: [] };
    const parsed = JSON.parse(raw) as Partial<SavedWorkspaceState>;
    if (!Array.isArray(parsed.documents)) return { documents: [] };
    return { documents: parsed.documents };
  } catch {
    return { documents: [] };
  }
}

function writeState(storage: Storage, state: SavedWorkspaceState): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    documents: state.documents.map(normalizeDocument).filter(Boolean),
  }));
}

function normalizeDocument(value: unknown): SavedSourceDocument | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedSourceDocument>;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") return null;
  const versions = Array.isArray(candidate.versions)
    ? candidate.versions.map(normalizeVersion).filter((version): version is SavedSourceVersion => version != null)
    : [];
  return {
    id: candidate.id,
    name: candidate.name,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : versions.at(-1)?.createdAt ?? "",
    versions: versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

function normalizeVersion(value: unknown): SavedSourceVersion | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedSourceVersion>;
  if (typeof candidate.id !== "string" || typeof candidate.createdAt !== "string" || typeof candidate.source !== "string") {
    return null;
  }
  return {
    id: candidate.id,
    createdAt: candidate.createdAt,
    source: candidate.source,
  };
}

function createId(prefix: string): string {
  const crypto = globalThis.crypto;
  const id = crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}
