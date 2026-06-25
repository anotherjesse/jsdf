import type { CodeEditor } from "./editor/code-editor";
import {
  createAppHealthDiagnosticsReader,
  exposeAppHealthDiagnostics,
  installAppHealthMonitor,
  type AppHealthDiagnosticsState,
} from "./editor/app-health";
import {
  configureGraphHistoryShortcutButtons,
  GRAPH_FILTER_SHORTCUTS,
  installAppKeyboardShortcuts,
  SOURCE_PRETTIFY_SHORTCUT,
} from "./editor/app-shortcuts";
import { queryAppElements } from "./editor/app-elements";
import {
  sessionIdFromLocation,
  type BrowserSessionCommandResult,
} from "./editor/browser-session";
import { createBrowserSessionController } from "./editor/browser-session-controller";
import { loadEditorPreferences, saveEditorPreferences } from "./editor/editor-preferences";
import {
  createEditorViewController,
} from "./editor/editor-view-controller";
import { sourceForExample } from "./editor/example-source";
import {
  createGraphInteractionController,
  type GraphInteractionController,
} from "./editor/graph-interaction-controller";
import { createGraphHistoryController } from "./editor/graph-history-controls";
import { GraphInspector } from "./editor/graph-inspector";
import { createSourceCompileController } from "./editor/source-compile-controller";
import {
  createSourceEditorController,
  type EditorStatusState,
} from "./editor/source-editor-controller";
import {
  boundsForExample,
  createPreviewProfile,
  previewProfileSnapshot,
  type PreviewProfile,
} from "./editor/preview-profile";
import { createPreviewBoundsController } from "./editor/preview-bounds-controller";
import { createSourceWorkspaceActions } from "./editor/source-workspace-actions";
import { createSourceWorkspaceSession } from "./editor/source-workspace-session";
import { supportedSummary, unsupportedOriginalApi } from "./api/completeness";
import { currentExample, examples } from "./examples";
import { hasWebGPU } from "./gpu/webgpu";
import type { Bounds3 } from "./mesh/bounds";
import {
  createPreviewViewportController,
  type PreviewViewportState,
} from "./preview/preview-viewport-controller";

const elements = queryAppElements();

let codeEditor: CodeEditor | null = null;
let graphInspector: GraphInspector | null = null;
let graphInteractionController: GraphInteractionController | null = null;
let activeExampleId = examples[0]?.id ?? "canonical";
const appHealthMonitor = installAppHealthMonitor();
const healthCheckMode = new URLSearchParams(window.location.search).has("app-health-check");
const activeBrowserSessionId = sessionIdFromLocation();
const editorPreferences = loadEditorPreferences();
const previewViewport = createPreviewViewportController({
  elements: elements.previewViewport,
  readState: readPreviewViewportState,
  onPreviewSettingsChange: updateSaveState,
});
const sourceCompileController = createSourceCompileController({
  overlay: elements.overlay,
  codeEditor: () => codeEditor,
  fallbackSource: () => sourceForExample(activeExampleId),
  graphInteraction: () => graphInteractionController,
  previewViewport,
  updateSaveState,
  setEditorStatus,
});
const sourceEditorController = createSourceEditorController({
  elements: elements.sourceEditor,
  initialGraphHintsEnabled: editorPreferences.graphHintsEnabled,
  codeEditor: () => codeEditor,
  sourceValid: () => sourceCompileController.sourceValid,
  preserveHiddenNodeKeys: () => graphInteractionController?.preserveHiddenNodeKeys(),
  clearSourceLinks: () => graphInteractionController?.clearSourceLinks(),
  updateSaveState,
  compileSource: sourceCompileController.compile,
  setEditorStatus,
  savePreferences: saveEditorPreferences,
});
const editorViewController = createEditorViewController({
  elements: elements.editorView,
  codeEditor: () => codeEditor,
  graphInspector: () => graphInspector,
  readSelectedTarget: () => graphInteractionController?.readSelectedEditorTarget() ?? { label: "", sourceLink: null, graphNode: null },
  flushPendingSourceCompile: sourceEditorController.flushPendingCompile,
  afterBrowserFrame,
  revealGraphSource: (link) => graphInteractionController?.revealGraphSource(link),
  revealSourceLinkInGraph: (link) => graphInteractionController?.handleSourceLinkSelect(link, { revealGraph: true }),
});
const previewBoundsController = createPreviewBoundsController({
  elements: elements.previewBounds,
  initialBounds: boundsForExample(activeExampleId),
  readActiveSdf: () => sourceCompileController.activeSdf,
  updateSaveState,
  setEditorStatus,
  invalidatePreview: invalidatePreviewForBoundsChange,
});
const appHealthDiagnostics = createAppHealthDiagnosticsReader({
  monitor: appHealthMonitor,
  elements: elements.appHealth,
  shortcuts: {
    prettify: SOURCE_PRETTIFY_SHORTCUT,
    graphFilter: GRAPH_FILTER_SHORTCUTS,
  },
  readState: readAppHealthDiagnosticsState,
});
const browserSessionController = createBrowserSessionController({
  sessionId: activeBrowserSessionId,
  elements: elements.browserSession,
  readStatus: readBrowserSessionStatus,
  readCode: currentSourceValue,
  setCode: applyBrowserSessionCode,
  captureScreenshot: captureBrowserSessionState,
  captureSnapshotState: captureBrowserSessionState,
});
const graphHistoryController = createGraphHistoryController({
  elements: elements.graphHistory,
  applyEditValue: (entry, value) => Boolean(graphInspector?.setParamValue(entry.nodeId, entry.path, value)),
  syncResetEdit: (entry, value) => {
    graphInteractionController?.syncCodeFromGraphEdit(entry, value);
  },
  onMutationStatus: (message, edit, value) => graphInteractionController?.applyGraphMutationStatus(message, edit, value),
  onDirtyEntriesChange: (entries) => graphInspector?.setDirtyParams(entries),
  onBeforeRenderJournal: () => {
    graphInteractionController?.clearGraphHistoryHoverKey();
  },
  sourceLinkForEntry: (entry) => graphInteractionController?.sourceLinkForEntry(entry) ?? null,
  selectedEntry: (entry) => graphInteractionController?.selectedEntry(entry) ?? false,
  onSelectEntry: (entry, options) => graphInteractionController?.selectGraphHistoryEntry(entry, options),
  onHoverEntry: (entry, options) => graphInteractionController?.hoverGraphHistoryEntry(entry, options),
  onClearEntryHover: () => graphInteractionController?.clearGraphHistoryEntryHover(),
});
graphInteractionController = createGraphInteractionController({
  codeEditor: () => codeEditor,
  graphInspector: () => graphInspector,
  activeSdf: () => sourceCompileController.activeSdf,
  editorView: editorViewController,
  previewViewport,
  graphHistory: graphHistoryController,
  updateSaveState,
  setEditorStatus,
  afterBrowserFrame,
});
const sourceWorkspace = createSourceWorkspaceSession({
  elements: elements.sourceWorkspace,
  initialName: currentExample(activeExampleId).name,
  initialSource: sourceForExample(activeExampleId),
  initialPreview: currentPreviewProfile(),
  currentSource: currentSourceValue,
  currentPreview: currentPreviewProfile,
  previewSnapshot: previewProfileSnapshot,
  activeExampleId: () => activeExampleId,
  canSave: () => previewBoundsController.valid,
  confirm: (message) => window.confirm(message),
});
const sourceWorkspaceActions = createSourceWorkspaceActions({
  elements: elements.sourceWorkspaceActions,
  session: sourceWorkspace,
  activeExampleId: () => activeExampleId,
  setActiveExampleId: (id) => {
    activeExampleId = id;
  },
  codeEditor: () => codeEditor,
  applyExampleBounds: (id) => previewBoundsController.applyExampleBounds(id),
  applyPreviewProfile,
  clearPendingHiddenNodeKeys: () => graphInteractionController?.clearPendingHiddenNodeKeys(),
  resetLoadedSourceState: () => graphInteractionController?.resetLoadedSourceState(),
  clearPendingSourceCompile: sourceEditorController.clearPendingCompile,
  compileSource: sourceCompileController.compile,
  currentSourceCompilesForSave: sourceEditorController.currentSourceCompilesForSave,
  currentDocumentName,
  currentPreviewProfile,
  boundsAreValid: () => previewBoundsController.valid,
  setEditorStatus,
  afterBrowserFrame,
  confirm: (message) => window.confirm(message),
});

browserSessionController.configure();
configureGraphHistoryShortcutButtons(elements.graphHistory.undoButton, elements.graphHistory.redoButton);
elements.apiStat.textContent = `${Object.values(supportedSummary).reduce((a, b) => a + b, 0)} supported; excludes ${unsupportedOriginalApi.length}`;
updateSaveState();
sourceWorkspaceActions.renderDialog();
exposeAppHealthDiagnostics(appHealthDiagnostics);

elements.loadSourceButton.addEventListener("click", sourceWorkspaceActions.openDialog);
elements.saveSourceButton.addEventListener("click", sourceWorkspaceActions.saveCurrentSource);
elements.closeSourceDialogButton.addEventListener("click", () => elements.sourceDialog.close());
elements.sourceDialog.addEventListener("click", (event) => {
  if (event.target === elements.sourceDialog) elements.sourceDialog.close();
});
elements.sourceDialog.addEventListener("close", () => {
  sourceWorkspaceActions.restoreDialogFocus();
  afterBrowserFrame(sourceWorkspaceActions.restoreDialogFocus);
});
window.addEventListener("resize", () => {
  previewViewport.handleResize();
});
installAppKeyboardShortcuts(window, {
  editorView: () => editorViewController.view,
  selectionFocusVisible: editorViewController.selectionFocusVisible,
  revealSelectedTarget: editorViewController.revealSelectedTarget,
  setEditorView: editorViewController.setView,
  focusGraphFilter: () => graphInspector?.focusFilter({ select: true }),
  toggleSourceHints: sourceEditorController.toggleGraphHints,
  prettifySource: sourceEditorController.prettifyCurrentSource,
  openSourceDialog: sourceWorkspaceActions.openDialog,
  saveSource: sourceWorkspaceActions.saveCurrentSourceFromShortcut,
  canUndoGraph: () => graphHistoryController.canUndo,
  canRedoGraph: () => graphHistoryController.canRedo,
  undoGraphEdit: () => graphHistoryController.undo(),
  redoGraphEdit: () => graphHistoryController.redo(),
});
window.addEventListener("beforeunload", handleBeforeUnload);

void boot();

async function boot(): Promise<void> {
  if (!hasWebGPU()) {
    elements.gpuBadge.textContent = "WebGL preview";
    elements.gpuBadge.classList.add("warn");
  } else {
    elements.gpuBadge.textContent = "WebGL + WebGPU";
    elements.gpuBadge.classList.add("ok");
  }

  try {
    previewViewport.initialize();
    graphInspector = new GraphInspector(elements.graphInspectorRoot, {
      onSelect: (node) => graphInteractionController?.selectNode(node),
      onHover: (node, options) => graphInteractionController?.handleGraphHover(node, options),
      onEdit: (edit) => graphInteractionController?.handleGraphEdit(edit),
      onSolo: (preview) => graphInteractionController?.handleSoloPreview(preview),
      onRevealSource: (link) => graphInteractionController?.revealGraphSource(link),
      onSourceHover: (link) => graphInteractionController?.handleGraphSourceHover(link),
      onVisibilityChange: (hiddenIds) => graphInteractionController?.handleGraphVisibilityChange(hiddenIds),
    });
    sourceCompileController.compile({ status: "Ready", statusState: "idle", invalidateMesh: false });
    await previewViewport.renderCurrent();
    const { createCodeEditor } = await import("./editor/code-editor");
    codeEditor = createCodeEditor(
      elements.codeEditorRoot,
      sourceForExample(activeExampleId),
      sourceEditorController.scheduleCompile,
      (link, options) => graphInteractionController?.handleSourceLinkSelect(link, options),
      (link, value, options) => graphInteractionController?.handleSourceLinkValueChange(link, value, options),
      (link, options) => graphInteractionController?.handleSourceLinkHover(link, options),
      (link) => graphInteractionController?.handleSourceLinkCursor(link),
      sourceEditorController.prettifyCurrentSource,
    );
    sourceEditorController.applyGraphHintsToEditor();
    if (healthCheckMode || !sourceWorkspaceActions.restoreDraft()) {
      sourceCompileController.refreshCurrentGraph();
    }
    sourceWorkspace.setDraftPersistenceEnabled(!healthCheckMode);
    updateSaveState();
    browserSessionController.connect();
  } catch (error) {
    elements.gpuBadge.textContent = "Preview error";
    elements.gpuBadge.classList.add("warn");
    elements.overlay.textContent = error instanceof Error ? error.message : String(error);
  }
}

function readBrowserSessionStatus(): BrowserSessionCommandResult {
  return {
    ...appHealthDiagnostics(),
    sessionId: activeBrowserSessionId,
    documentName: currentDocumentName(),
  };
}

async function applyBrowserSessionCode(code: string, comment: string): Promise<BrowserSessionCommandResult> {
  sourceEditorController.clearPendingCompile();
  graphInteractionController?.preserveHiddenNodeKeys();
  codeEditor?.setValue(code);
  updateSaveState();
  sourceCompileController.compile({ status: comment ? "Agent update" : "Agent update" });
  return captureBrowserSessionState();
}

async function captureBrowserSessionState(): Promise<BrowserSessionCommandResult> {
  await renderShaderPreviewForSession();
  return {
    code: currentSourceValue(),
    sourceValid: sourceCompileController.sourceValid,
    status: elements.editorStatus.textContent ?? "",
    viewMode: previewViewport.viewMode,
    previewLayout: previewViewport.previewLayout,
    screenshotDataUrl: elements.canvas.toDataURL("image/png"),
  };
}

async function renderShaderPreviewForSession(): Promise<void> {
  await previewViewport.renderShaderPreviewForSession(sourceCompileController.sourceValid, waitForBrowserFrame);
}

function waitForBrowserFrame(): Promise<void> {
  return new Promise((resolve) => afterBrowserFrame(resolve));
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!sourceWorkspace.hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "";
}

function setEditorStatus(message: string, state: EditorStatusState): void {
  elements.editorStatus.textContent = message;
  if (state === "idle") elements.editorStatus.removeAttribute("data-state");
  else elements.editorStatus.dataset.state = state;
  elements.editorStatus.title = message;
}

function afterBrowserFrame(callback: () => void): void {
  let settled = false;
  const timeout = window.setTimeout(run, 50);
  function run(): void {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    callback();
  }
  window.requestAnimationFrame(run);
}

function readAppHealthDiagnosticsState(): AppHealthDiagnosticsState {
  const graphState = graphInteractionController?.readDiagnosticsState() ?? {
    sourceLinks: 0,
    selectedNode: null,
    selectedSourceLink: null,
    hiddenNodes: 0,
  };
  return {
    ready: Boolean(codeEditor && graphInspector && sourceCompileController.activeSdf && previewViewport.ready),
    editorReady: Boolean(codeEditor),
    graphReady: Boolean(graphInspector),
    activeSdfReady: Boolean(sourceCompileController.activeSdf),
    healthCheckMode,
    dirty: sourceWorkspace.hasUnsavedChanges,
    status: elements.editorStatus.textContent ?? "",
    sourceCompilePending: sourceEditorController.sourceCompilePending,
    sourceValid: sourceCompileController.sourceValid,
    viewMode: previewViewport.viewMode,
    editorView: editorViewController.view,
    previewLayout: previewViewport.previewLayout,
    meshAlgorithm: previewViewport.meshAlgorithm,
    sourceLinks: graphState.sourceLinks,
    selectedNode: graphState.selectedNode,
    selectedSourceLink: graphState.selectedSourceLink,
    sourceRevealedDecorations: codeEditor?.sourceDecorationCount("revealed") ?? 0,
    hiddenNodes: graphState.hiddenNodes,
    meshTriangles: previewViewport.meshTriangles,
    meshBuildPending: previewViewport.meshBuildPending,
  };
}

function currentBounds(): Bounds3 {
  return previewBoundsController.bounds;
}

function readPreviewViewportState(): PreviewViewportState {
  const graphPreviewState = graphInteractionController?.readPreviewState() ?? {
    visibleSdf: null,
    renderSdf: null,
    shaderHighlight: { node: null, mode: "mark" },
    meshHighlight: { node: null, mode: "mark" },
    soloOverlayText: "",
    focusOverlayText: "",
    hasSoloPreview: false,
  };
  return {
    activeSdf: sourceCompileController.activeSdf,
    visibleSdf: graphPreviewState.visibleSdf,
    renderSdf: graphPreviewState.renderSdf,
    bounds: currentBounds(),
    documentName: currentDocumentName(),
    shaderHighlight: graphPreviewState.shaderHighlight,
    meshHighlight: graphPreviewState.meshHighlight,
    soloOverlayText: graphPreviewState.soloOverlayText,
    focusOverlayText: graphPreviewState.focusOverlayText,
    hasSoloPreview: graphPreviewState.hasSoloPreview,
  };
}

function currentDocumentName(): string {
  return sourceWorkspace.currentDocumentName();
}

function currentSourceValue(): string {
  return sourceCompileController.currentSource();
}

function updateSaveState(): void {
  sourceWorkspace.updateSaveState();
}

function applyPreviewProfile(profile: PreviewProfile): void {
  previewBoundsController.applyProfileBounds(profile.bounds);
  graphInteractionController?.applyPendingHiddenNodeKeys(profile.hiddenNodeKeys ?? []);
  previewViewport.applyRange(elements.stepsInput, elements.stepsOutput, profile.raySteps);
  previewViewport.applyRange(elements.gridInput, elements.gridOutput, profile.meshGrid);
  previewViewport.setMeshAlgorithmMode(profile.meshAlgorithm, { rebuild: false });
  previewViewport.setPreviewLayout(profile.layout ?? "single", { recordChange: false });
}

function invalidatePreviewForBoundsChange(): void {
  previewViewport.invalidateMeshForActiveSdf();
  previewViewport.schedulePreview(0);
}

function currentPreviewProfile(): PreviewProfile {
  return createPreviewProfile({
    bounds: previewBoundsController.bounds,
    meshGrid: previewViewport.meshGrid,
    raySteps: previewViewport.raySteps,
    meshAlgorithm: previewViewport.meshAlgorithm,
    layout: previewViewport.previewLayout,
    hiddenNodeKeys: graphInteractionController?.hiddenNodeKeysForCurrentGraph() ?? [],
  });
}
