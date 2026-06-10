export type SavedMeshAlgorithm = "surface-net" | "tetra";
export type SavedBounds3 = [[number, number, number], [number, number, number]];

export interface SavedSourcePreview {
  bounds: SavedBounds3;
  meshGrid: number;
  raySteps: number;
  meshAlgorithm: SavedMeshAlgorithm;
  hiddenNodeKeys?: string[];
}

export interface SavedSourceVersion {
  id: string;
  createdAt: string;
  source: string;
  preview?: SavedSourcePreview;
}

export interface SavedSourceDocument {
  id: string;
  name: string;
  updatedAt: string;
  versions: SavedSourceVersion[];
}

export interface SavedSourceDraft {
  updatedAt: string;
  name: string;
  source: string;
  preview?: SavedSourcePreview;
  activeDocumentId: string | null;
  activeVersionId: string | null;
  activeExampleId: string;
}

interface SavedWorkspaceState {
  documents: SavedSourceDocument[];
}

const STORAGE_KEY = "sdf-browser-workspace-v1";
const DRAFT_STORAGE_KEY = "sdf-browser-draft-v1";

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
  preview: SavedSourcePreview | null = null,
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
    ...(preview ? { preview } : {}),
  });
  writeState(storage, state);
  return normalizeDocument(document) ?? document;
}

export function deleteSavedSourceDocument(docId: string, storage = globalThis.localStorage): boolean {
  const state = readState(storage);
  const nextDocuments = state.documents.filter((doc) => doc.id !== docId);
  if (nextDocuments.length === state.documents.length) return false;
  writeState(storage, { documents: nextDocuments });
  return true;
}

export function deleteSavedSourceVersion(
  docId: string,
  versionId: string,
  storage = globalThis.localStorage,
): SavedSourceDocument | null {
  const state = readState(storage);
  const document = state.documents.find((doc) => doc.id === docId);
  if (!document) return null;

  const nextVersions = document.versions.filter((version) => version.id !== versionId);
  if (nextVersions.length === document.versions.length) return normalizeDocument(document) ?? document;

  if (nextVersions.length === 0) {
    writeState(storage, { documents: state.documents.filter((doc) => doc.id !== docId) });
    return null;
  }

  document.versions = nextVersions;
  document.updatedAt = latestSourceVersion(normalizeDocument(document) ?? document)?.createdAt ?? document.updatedAt;
  writeState(storage, state);
  return normalizeDocument(document);
}

export function loadSourceDraft(storage = globalThis.localStorage): SavedSourceDraft | null {
  try {
    const raw = storage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return normalizeDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveSourceDraft(
  draft: Omit<SavedSourceDraft, "updatedAt">,
  storage = globalThis.localStorage,
): SavedSourceDraft {
  const next: SavedSourceDraft = {
    ...draft,
    updatedAt: new Date().toISOString(),
  };
  storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearSourceDraft(storage = globalThis.localStorage): void {
  storage.removeItem(DRAFT_STORAGE_KEY);
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

function normalizeDraft(value: unknown): SavedSourceDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedSourceDraft>;
  if (typeof candidate.updatedAt !== "string" || typeof candidate.name !== "string" || typeof candidate.source !== "string") {
    return null;
  }
  const preview = normalizePreview(candidate.preview);
  return {
    updatedAt: candidate.updatedAt,
    name: candidate.name,
    source: candidate.source,
    ...(preview ? { preview } : {}),
    activeDocumentId: typeof candidate.activeDocumentId === "string" ? candidate.activeDocumentId : null,
    activeVersionId: typeof candidate.activeVersionId === "string" ? candidate.activeVersionId : null,
    activeExampleId: typeof candidate.activeExampleId === "string" ? candidate.activeExampleId : "",
  };
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
  const preview = normalizePreview(candidate.preview);
  return {
    id: candidate.id,
    createdAt: candidate.createdAt,
    source: candidate.source,
    ...(preview ? { preview } : {}),
  };
}

function normalizePreview(value: unknown): SavedSourcePreview | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedSourcePreview>;
  const bounds = normalizeBounds(candidate.bounds);
  if (!bounds) return null;

  const meshGrid = normalizePositiveNumber(candidate.meshGrid);
  const raySteps = normalizePositiveNumber(candidate.raySteps);
  if (meshGrid == null || raySteps == null) return null;

  const meshAlgorithm = candidate.meshAlgorithm === "tetra" ? "tetra" : "surface-net";
  const hiddenNodeKeys = normalizeHiddenNodeKeys(candidate.hiddenNodeKeys);
  return {
    bounds,
    meshGrid,
    raySteps,
    meshAlgorithm,
    ...(hiddenNodeKeys.length > 0 ? { hiddenNodeKeys } : {}),
  };
}

function normalizeHiddenNodeKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value
    .map((key) => typeof key === "string" ? key.trim() : "")
    .filter((key) => key.length > 0);
  return [...new Set(keys)].sort();
}

function normalizeBounds(value: unknown): SavedBounds3 | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const lo = normalizeVector3(value[0]);
  const hi = normalizeVector3(value[1]);
  if (!lo || !hi) return null;
  return [lo, hi];
}

function normalizeVector3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const vector = value.slice(0, 3).map(Number);
  if (!vector.every(Number.isFinite)) return null;
  return [vector[0], vector[1], vector[2]];
}

function normalizePositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function createId(prefix: string): string {
  const crypto = globalThis.crypto;
  const id = crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}
