import type { CodeEditor } from "./code-editor";
import { sourceForExample } from "./example-source";
import type { PreviewProfile } from "./preview-profile";
import { renderSourceDialog } from "./source-dialog";
import type { SourceWorkspaceSession } from "./source-workspace-session";
import {
  deleteSavedSourceDocument,
  deleteSavedSourceVersion,
  latestSourceVersion,
  listSavedSourceDocuments,
  loadSavedSourceVersion,
  saveSourceVersion,
  type SavedSourceDraft,
  type SavedSourceDocument,
} from "./workspace-storage";
import { currentExample, examples } from "../examples";

type EditorStatusState = "idle" | "ok" | "pending" | "error";

interface SourceCompileOptions {
  status: string;
  statusState?: EditorStatusState;
  invalidateMesh?: boolean;
}

export interface SourceWorkspaceActionsElements {
  dialog: HTMLDialogElement;
  list: HTMLElement;
  loadButton: HTMLButtonElement;
}

export interface SourceWorkspaceActionsOptions {
  elements: SourceWorkspaceActionsElements;
  session: SourceWorkspaceSession;
  activeExampleId(): string;
  setActiveExampleId(id: string): void;
  codeEditor(): CodeEditor | null;
  applyExampleBounds(id: string): void;
  applyPreviewProfile(profile: PreviewProfile): void;
  clearPendingHiddenNodeKeys(): void;
  resetLoadedSourceState(): void;
  clearPendingSourceCompile(): void;
  compileSource(options: SourceCompileOptions): boolean;
  currentSourceCompilesForSave(): boolean;
  currentDocumentName(): string;
  currentPreviewProfile(): PreviewProfile;
  boundsAreValid(): boolean;
  setEditorStatus(message: string, state: EditorStatusState): void;
  afterBrowserFrame(callback: () => void): void;
  confirm(message: string): boolean;
}

export interface SourceWorkspaceActions {
  openDialog(): void;
  renderDialog(): ReturnType<typeof renderSourceDialog>;
  restoreDialogFocus(): void;
  restoreDraft(): boolean;
  saveCurrentSource(): void;
  saveCurrentSourceFromShortcut(): void;
}

export function createSourceWorkspaceActions(options: SourceWorkspaceActionsOptions): SourceWorkspaceActions {
  const actions = {
    openDialog,
    renderDialog,
    restoreDialogFocus,
    restoreDraft,
    saveCurrentSource,
    saveCurrentSourceFromShortcut,
  };

  return actions;

  function openDialog(): void {
    const dialog = renderDialog();
    if (options.elements.dialog.open) {
      dialog.focusSearch();
      return;
    }
    options.elements.dialog.showModal();
    options.afterBrowserFrame(() => dialog.focusSearch());
  }

  function renderDialog(): ReturnType<typeof renderSourceDialog> {
    return renderSourceDialog(options.elements.list, {
      examples,
      savedDocuments: listSavedSourceDocuments(),
      activeExampleId: options.activeExampleId(),
      activeDocumentId: options.session.activeDocumentId,
      activeVersionId: options.session.activeVersionId,
    }, {
      loadExample,
      loadSaved: loadSavedSourceById,
      deleteDocument: deleteSavedDocument,
      deleteVersion: deleteSavedVersion,
    });
  }

  function restoreDialogFocus(): void {
    if (options.elements.dialog.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    options.elements.loadButton.focus({ preventScroll: true });
  }

  function loadExample(id: string): void {
    if (!options.session.confirmDiscardUnsavedChanges()) return;
    options.clearPendingSourceCompile();
    options.setActiveExampleId(id);
    options.applyExampleBounds(id);
    options.session.loadExample(currentExample(id).name);
    const source = sourceForExample(id);
    options.resetLoadedSourceState();
    options.clearPendingHiddenNodeKeys();
    options.codeEditor()?.setValue(source);
    options.session.markClean(source, options.session.activeSourceName);
    renderDialog();
    options.elements.dialog.close();
    options.compileSource({ status: "Ready", statusState: "idle" });
  }

  function loadSavedSourceById(documentId: string, versionId: string): void {
    if (!options.session.confirmDiscardUnsavedChanges()) return;
    const loaded = loadSavedSourceVersion(documentId, versionId);
    if (!loaded) {
      options.setEditorStatus("Saved source not found", "error");
      return;
    }
    loadSavedSource(loaded.document, loaded.version.id, loaded.version.source, loaded.version.preview);
  }

  function loadSavedSource(document: SavedSourceDocument, versionId: string, source: string, preview?: PreviewProfile): void {
    options.clearPendingSourceCompile();
    options.session.loadSaved(document.id, versionId, document.name);
    if (preview) options.applyPreviewProfile(preview);
    else options.clearPendingHiddenNodeKeys();
    options.resetLoadedSourceState();
    options.codeEditor()?.setValue(source);
    options.session.markClean(source, document.name);
    renderDialog();
    options.elements.dialog.close();
    options.compileSource({ status: "Ready", statusState: "idle" });
  }

  function restoreDraft(): boolean {
    const codeEditor = options.codeEditor();
    if (!codeEditor) return false;
    const draft = options.session.readDraft();
    if (!draft) return false;

    options.clearPendingSourceCompile();
    restoreDraftExample(draft);
    options.session.restoreDraft(draft);
    if (draft.preview) {
      options.applyPreviewProfile(draft.preview);
    } else {
      options.clearPendingHiddenNodeKeys();
      options.applyExampleBounds(options.activeExampleId());
    }
    options.resetLoadedSourceState();
    codeEditor.setValue(draft.source);
    renderDialog();
    options.compileSource({ status: "Recovered draft", statusState: "pending" });
    return true;
  }

  function restoreDraftExample(draft: SavedSourceDraft): void {
    if (examples.some((example) => example.id === draft.activeExampleId)) {
      options.setActiveExampleId(draft.activeExampleId);
    }
  }

  function saveCurrentSource(): void {
    if (!options.currentSourceCompilesForSave()) return;

    const source = options.codeEditor()?.getValue() ?? sourceForExample(options.activeExampleId());
    try {
      const saved = saveSourceVersion(
        options.currentDocumentName(),
        source,
        options.session.activeDocumentId,
        options.currentPreviewProfile(),
      );
      const latest = latestSourceVersion(saved);
      options.session.markSaved(saved.id, latest?.id ?? null, saved.name);
      options.session.markClean(source, saved.name);
      renderDialog();
      options.setEditorStatus("Saved", "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.setEditorStatus(`Save failed: ${message}`, "error");
    }
  }

  function saveCurrentSourceFromShortcut(): void {
    if (!options.boundsAreValid()) {
      options.setEditorStatus("Fix bounds before saving", "error");
      return;
    }
    if (!options.session.hasUnsavedChanges) {
      options.setEditorStatus("No changes to save", "idle");
      return;
    }
    saveCurrentSource();
  }

  function deleteSavedDocument(documentId: string): void {
    const savedDocument = listSavedSourceDocuments().find((candidate) => candidate.id === documentId);
    if (!savedDocument) {
      renderDialog();
      return;
    }
    if (!options.confirm(`Delete "${savedDocument.name}" and all of its saved versions?`)) return;

    if (!deleteSavedSourceDocument(documentId)) {
      options.setEditorStatus("Saved shape not found", "error");
      renderDialog();
      return;
    }

    if (options.session.activeDocumentId === documentId) options.session.detachDeletedSource();
    renderDialog();
    options.setEditorStatus("Deleted saved shape", "ok");
  }

  function deleteSavedVersion(documentId: string, versionId: string): void {
    const loaded = loadSavedSourceVersion(documentId, versionId);
    if (!loaded) {
      renderDialog();
      return;
    }
    if (!options.confirm(`Delete this saved version of "${loaded.document.name}"?`)) return;

    deleteSavedSourceVersion(documentId, versionId);
    if (options.session.activeDocumentId === documentId && options.session.activeVersionId === versionId) {
      options.session.detachDeletedSource();
    }
    renderDialog();
    options.setEditorStatus("Deleted saved version", "ok");
  }
}
