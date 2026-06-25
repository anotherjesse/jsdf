import type { PreviewViewportController, PreviewViewportState } from "../preview/preview-viewport-controller";
import type { AppHealthDiagnosticsState } from "./app-health";
import type { CodeEditor } from "./code-editor";
import type { EditorViewController } from "./editor-view-controller";
import type { GraphInspector } from "./graph-inspector";
import type { GraphInteractionController } from "./graph-interaction-controller";
import type { PreviewBoundsController } from "./preview-bounds-controller";
import { createPreviewProfile, type PreviewProfile } from "./preview-profile";
import type { SourceCompileController } from "./source-compile-controller";
import type { SourceEditorController } from "./source-editor-controller";
import type { SourceWorkspaceSession } from "./source-workspace-session";

export interface AppPreviewSettingElements {
  stepsInput: HTMLInputElement;
  stepsOutput: HTMLOutputElement;
  gridInput: HTMLInputElement;
  gridOutput: HTMLOutputElement;
}

export interface AppStateModelOptions {
  editorStatus: HTMLElement;
  fallbackDocumentName(): string;
  healthCheckMode(): boolean;
  codeEditor(): CodeEditor | null;
  graphInspector(): GraphInspector | null;
  graphInteraction(): GraphInteractionController | null;
  sourceWorkspace(): SourceWorkspaceSession | null;
  sourceCompile: SourceCompileController;
  sourceEditor: SourceEditorController;
  editorView: EditorViewController;
  previewBounds: PreviewBoundsController;
  previewViewport: PreviewViewportController;
  previewSettingsElements: AppPreviewSettingElements;
}

export interface AppStateModel {
  readAppHealthDiagnosticsState(): AppHealthDiagnosticsState;
  readPreviewViewportState(): PreviewViewportState;
  currentDocumentName(): string;
  currentSourceValue(): string;
  updateSaveState(): void;
  hasUnsavedChanges(): boolean;
  applyPreviewProfile(profile: PreviewProfile): void;
  invalidatePreviewForBoundsChange(): void;
  currentPreviewProfile(): PreviewProfile;
}

export function createAppStateModel(options: AppStateModelOptions): AppStateModel {
  function currentDocumentName(): string {
    return options.sourceWorkspace()?.currentDocumentName() ?? options.fallbackDocumentName();
  }

  function currentSourceValue(): string {
    return options.sourceCompile.currentSource();
  }

  function updateSaveState(): void {
    options.sourceWorkspace()?.updateSaveState();
  }

  function hasUnsavedChanges(): boolean {
    return options.sourceWorkspace()?.hasUnsavedChanges ?? false;
  }

  function readAppHealthDiagnosticsState(): AppHealthDiagnosticsState {
    const graphState = options.graphInteraction()?.readDiagnosticsState() ?? {
      sourceLinks: 0,
      selectedNode: null,
      selectedSourceLink: null,
      hiddenNodes: 0,
    };
    return {
      ready: Boolean(options.codeEditor() && options.graphInspector() && options.sourceCompile.activeSdf && options.previewViewport.ready),
      editorReady: Boolean(options.codeEditor()),
      graphReady: Boolean(options.graphInspector()),
      activeSdfReady: Boolean(options.sourceCompile.activeSdf),
      healthCheckMode: options.healthCheckMode(),
      dirty: hasUnsavedChanges(),
      status: options.editorStatus.textContent ?? "",
      sourceCompilePending: options.sourceEditor.sourceCompilePending,
      sourceValid: options.sourceCompile.sourceValid,
      viewMode: options.previewViewport.viewMode,
      editorView: options.editorView.view,
      previewLayout: options.previewViewport.previewLayout,
      meshAlgorithm: options.previewViewport.meshAlgorithm,
      sourceLinks: graphState.sourceLinks,
      selectedNode: graphState.selectedNode,
      selectedSourceLink: graphState.selectedSourceLink,
      sourceRevealedDecorations: options.codeEditor()?.sourceDecorationCount("revealed") ?? 0,
      hiddenNodes: graphState.hiddenNodes,
      meshTriangles: options.previewViewport.meshTriangles,
      meshBuildPending: options.previewViewport.meshBuildPending,
    };
  }

  function readPreviewViewportState(): PreviewViewportState {
    const graphPreviewState = options.graphInteraction()?.readPreviewState() ?? {
      visibleSdf: null,
      renderSdf: null,
      shaderHighlight: { node: null, mode: "mark" },
      meshHighlight: { node: null, mode: "mark" },
      soloOverlayText: "",
      focusOverlayText: "",
      hasSoloPreview: false,
    };
    return {
      activeSdf: options.sourceCompile.activeSdf,
      visibleSdf: graphPreviewState.visibleSdf,
      renderSdf: graphPreviewState.renderSdf,
      bounds: options.previewBounds.bounds,
      documentName: currentDocumentName(),
      shaderHighlight: graphPreviewState.shaderHighlight,
      meshHighlight: graphPreviewState.meshHighlight,
      soloOverlayText: graphPreviewState.soloOverlayText,
      focusOverlayText: graphPreviewState.focusOverlayText,
      hasSoloPreview: graphPreviewState.hasSoloPreview,
    };
  }

  function applyPreviewProfile(profile: PreviewProfile): void {
    const { previewSettingsElements } = options;
    options.previewBounds.applyProfileBounds(profile.bounds);
    options.graphInteraction()?.applyPendingHiddenNodeKeys(profile.hiddenNodeKeys ?? []);
    options.previewViewport.applyRange(previewSettingsElements.stepsInput, previewSettingsElements.stepsOutput, profile.raySteps);
    options.previewViewport.applyRange(previewSettingsElements.gridInput, previewSettingsElements.gridOutput, profile.meshGrid);
    options.previewViewport.setMeshAlgorithmMode(profile.meshAlgorithm, { rebuild: false });
    options.previewViewport.setPreviewLayout(profile.layout ?? "single", { recordChange: false });
  }

  function invalidatePreviewForBoundsChange(): void {
    options.previewViewport.invalidateMeshForActiveSdf();
    options.previewViewport.schedulePreview(0);
  }

  function currentPreviewProfile(): PreviewProfile {
    return createPreviewProfile({
      bounds: options.previewBounds.bounds,
      meshGrid: options.previewViewport.meshGrid,
      raySteps: options.previewViewport.raySteps,
      meshAlgorithm: options.previewViewport.meshAlgorithm,
      layout: options.previewViewport.previewLayout,
      hiddenNodeKeys: options.graphInteraction()?.hiddenNodeKeysForCurrentGraph() ?? [],
    });
  }

  return {
    readAppHealthDiagnosticsState,
    readPreviewViewportState,
    currentDocumentName,
    currentSourceValue,
    updateSaveState,
    hasUnsavedChanges,
    applyPreviewProfile,
    invalidatePreviewForBoundsChange,
    currentPreviewProfile,
  };
}
