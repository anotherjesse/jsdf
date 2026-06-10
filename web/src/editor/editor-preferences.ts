export interface EditorPreferences {
  graphHintsEnabled: boolean;
}

const STORAGE_KEY = "sdf-browser-editor-preferences-v1";
const DEFAULT_PREFERENCES: EditorPreferences = {
  graphHintsEnabled: true,
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
  return {
    graphHintsEnabled: typeof candidate.graphHintsEnabled === "boolean"
      ? candidate.graphHintsEnabled
      : DEFAULT_PREFERENCES.graphHintsEnabled,
  };
}
