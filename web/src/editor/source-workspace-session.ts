import {
  clearSourceDraft,
  loadSourceDraft,
  saveSourceDraft,
  type SavedSourceDraft,
  type SavedSourcePreview,
} from "./workspace-storage";

export interface SourceWorkspaceSessionElements {
  documentNameInput: HTMLInputElement;
  dirtyIndicator: HTMLElement;
  saveButton: HTMLButtonElement;
}

export interface SourceWorkspaceSessionOptions {
  elements: SourceWorkspaceSessionElements;
  initialName: string;
  initialSource: string;
  initialPreview: SavedSourcePreview;
  currentSource(): string;
  currentPreview(): SavedSourcePreview;
  previewSnapshot(profile: SavedSourcePreview): string;
  activeExampleId(): string;
  canSave(): boolean;
  confirm(message: string): boolean;
}

export interface SourceWorkspaceSession {
  readonly activeDocumentId: string | null;
  readonly activeVersionId: string | null;
  readonly activeSourceName: string;
  readonly hasUnsavedChanges: boolean;
  readonly draftPersistenceEnabled: boolean;
  setDraftPersistenceEnabled(enabled: boolean): void;
  currentDocumentName(): string;
  readDraft(): SavedSourceDraft | null;
  loadExample(name: string): void;
  loadSaved(documentId: string, versionId: string, name: string): void;
  restoreDraft(draft: SavedSourceDraft): void;
  markSaved(documentId: string, versionId: string | null, name: string): void;
  markClean(source: string, name: string): void;
  detachDeletedSource(): void;
  updateSaveState(): void;
  confirmDiscardUnsavedChanges(): boolean;
}

export function createSourceWorkspaceSession(options: SourceWorkspaceSessionOptions): SourceWorkspaceSession {
  return new SourceWorkspaceSessionController(options);
}

class SourceWorkspaceSessionController implements SourceWorkspaceSession {
  private activeDocumentIdValue: string | null = null;
  private activeVersionIdValue: string | null = null;
  private activeSourceNameValue: string;
  private cleanSourceSnapshot: string;
  private cleanNameSnapshot: string;
  private cleanPreviewSnapshot: string;
  private hasUnsavedChangesValue = false;
  private draftPersistenceEnabledValue = false;

  constructor(private readonly options: SourceWorkspaceSessionOptions) {
    this.activeSourceNameValue = options.initialName;
    this.cleanSourceSnapshot = options.initialSource;
    this.cleanNameSnapshot = options.initialName;
    this.cleanPreviewSnapshot = options.previewSnapshot(options.initialPreview);
    options.elements.documentNameInput.value = options.initialName;
    options.elements.documentNameInput.addEventListener("input", () => this.updateSaveState());
    this.updateSaveState();
  }

  get activeDocumentId(): string | null {
    return this.activeDocumentIdValue;
  }

  get activeVersionId(): string | null {
    return this.activeVersionIdValue;
  }

  get activeSourceName(): string {
    return this.activeSourceNameValue;
  }

  get hasUnsavedChanges(): boolean {
    return this.hasUnsavedChangesValue;
  }

  get draftPersistenceEnabled(): boolean {
    return this.draftPersistenceEnabledValue;
  }

  setDraftPersistenceEnabled(enabled: boolean): void {
    this.draftPersistenceEnabledValue = enabled;
    this.syncSourceDraft();
  }

  currentDocumentName(): string {
    return this.options.elements.documentNameInput.value.trim() || this.activeSourceNameValue || "Untitled SDF";
  }

  readDraft(): SavedSourceDraft | null {
    return loadSourceDraft();
  }

  loadExample(name: string): void {
    this.activeDocumentIdValue = null;
    this.activeVersionIdValue = null;
    this.activeSourceNameValue = name;
    this.options.elements.documentNameInput.value = name;
  }

  loadSaved(documentId: string, versionId: string, name: string): void {
    this.activeDocumentIdValue = documentId;
    this.activeVersionIdValue = versionId;
    this.activeSourceNameValue = name;
    this.options.elements.documentNameInput.value = name;
  }

  restoreDraft(draft: SavedSourceDraft): void {
    this.activeDocumentIdValue = draft.activeDocumentId;
    this.activeVersionIdValue = draft.activeVersionId;
    this.activeSourceNameValue = draft.name;
    this.options.elements.documentNameInput.value = draft.name;
  }

  markSaved(documentId: string, versionId: string | null, name: string): void {
    this.activeDocumentIdValue = documentId;
    this.activeVersionIdValue = versionId;
    this.activeSourceNameValue = name;
    this.options.elements.documentNameInput.value = name;
  }

  markClean(source: string, name: string): void {
    this.cleanSourceSnapshot = source;
    this.cleanNameSnapshot = name;
    this.cleanPreviewSnapshot = this.options.previewSnapshot(this.options.currentPreview());
    this.updateSaveState();
  }

  detachDeletedSource(): void {
    this.activeDocumentIdValue = null;
    this.activeVersionIdValue = null;
    this.activeSourceNameValue = this.currentDocumentName();
    this.cleanSourceSnapshot = "";
    this.cleanNameSnapshot = "";
    this.updateSaveState();
  }

  updateSaveState(): void {
    const nextDirty = this.options.currentSource() !== this.cleanSourceSnapshot
      || this.currentDocumentName() !== this.cleanNameSnapshot
      || this.options.previewSnapshot(this.options.currentPreview()) !== this.cleanPreviewSnapshot;
    this.hasUnsavedChangesValue = nextDirty;
    this.options.elements.saveButton.disabled = !nextDirty || !this.options.canSave();
    this.options.elements.dirtyIndicator.hidden = !nextDirty;
    this.syncSourceDraft();
  }

  confirmDiscardUnsavedChanges(): boolean {
    return !this.hasUnsavedChangesValue || this.options.confirm("Discard unsaved changes and load another shape?");
  }

  private syncSourceDraft(): void {
    if (!this.draftPersistenceEnabledValue) return;
    try {
      if (!this.hasUnsavedChangesValue) {
        clearSourceDraft();
        return;
      }
      saveSourceDraft({
        name: this.currentDocumentName(),
        source: this.options.currentSource(),
        preview: this.options.currentPreview(),
        activeDocumentId: this.activeDocumentIdValue,
        activeVersionId: this.activeVersionIdValue,
        activeExampleId: this.options.activeExampleId(),
      });
    } catch {
      // Draft persistence is a fallback; the visible save/error flow stays authoritative.
    }
  }
}
