export type EditorFeatureMode = "simple" | "advanced";

export interface EditorPreferences {
  editorMode: EditorFeatureMode;
  graphHintsEnabled: boolean;
}

const STORAGE_KEY = "sdf-browser-editor-preferences-v1";
const DEFAULT_PREFERENCES: EditorPreferences = {
  editorMode: "simple",
  graphHintsEnabled: false,
};

export function loadEditorPreferences(storage = globalThis.localStorage): EditorPreferences {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveEditorPreferences(
  preferences: EditorPreferences,
  storage = globalThis.localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(normalizePreferences(preferences)));
}

function normalizePreferences(value: unknown): EditorPreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_PREFERENCES };
  const candidate = value as Partial<EditorPreferences>;
  const editorMode = candidate.editorMode === "advanced" ? "advanced" : DEFAULT_PREFERENCES.editorMode;
  return {
    editorMode,
    graphHintsEnabled: editorMode === "advanced" && typeof candidate.graphHintsEnabled === "boolean"
      ? candidate.graphHintsEnabled
      : DEFAULT_PREFERENCES.graphHintsEnabled,
  };
}
