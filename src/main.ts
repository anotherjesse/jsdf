import type { CodeEditor } from "./editor/code-editor";
import {
  createAppHealthDiagnosticsReader,
  exposeAppHealthDiagnostics,
  installAppHealthMonitor,
} from "./editor/app-health";
import { afterBrowserFrame } from "./editor/app-frame";
import { createAppStateModel, type AppStateModel } from "./editor/app-state-model";
import {
  configureGraphHistoryShortcutButtons,
  GRAPH_FILTER_SHORTCUTS,
  installAppKeyboardShortcuts,
  SOURCE_PRETTIFY_SHORTCUT,
} from "./editor/app-shortcuts";
import { queryAppElements } from "./editor/app-elements";
import { createBrowserSessionBridge } from "./editor/browser-session-bridge";
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
  previewProfileSnapshot,
} from "./editor/preview-profile";
import { createPreviewBoundsController } from "./editor/preview-bounds-controller";
import { createSourceWorkspaceActions } from "./editor/source-workspace-actions";
import { createSourceWorkspaceSession, type SourceWorkspaceSession } from "./editor/source-workspace-session";
import { supportedSummary, unsupportedOriginalApi } from "./api/completeness";
import { currentExample, examples } from "./examples";
import { hasWebGPU } from "./gpu/webgpu";
import { createPreviewViewportController } from "./preview/preview-viewport-controller";

const elements = queryAppElements();

let codeEditor: CodeEditor | null = null;
let graphInspector: GraphInspector | null = null;
let graphInteractionController: GraphInteractionController | null = null;
let sourceWorkspace: SourceWorkspaceSession | null = null;
let appState: AppStateModel;
let activeExampleId = examples[0]?.id ?? "canonical";
const appHealthMonitor = installAppHealthMonitor();
const healthCheckMode = new URLSearchParams(window.location.search).has("app-health-check");
const editorPreferences = loadEditorPreferences();
const previewViewport = createPreviewViewportController({
  elements: elements.previewViewport,
  readState: () => appState.readPreviewViewportState(),
  onPreviewSettingsChange: () => appState.updateSaveState(),
});
const sourceCompileController = createSourceCompileController({
  overlay: elements.overlay,
  codeEditor: () => codeEditor,
  fallbackSource: () => sourceForExample(activeExampleId),
  graphInteraction: () => graphInteractionController,
  previewViewport,
  updateSaveState: () => appState.updateSaveState(),
  setEditorStatus,
});
const sourceEditorController = createSourceEditorController({
  elements: elements.sourceEditor,
  initialGraphHintsEnabled: editorPreferences.graphHintsEnabled,
  codeEditor: () => codeEditor,
  sourceValid: () => sourceCompileController.sourceValid,
  preserveHiddenNodeKeys: () => graphInteractionController?.preserveHiddenNodeKeys(),
  clearSourceLinks: () => graphInteractionController?.clearSourceLinks(),
  updateSaveState: () => appState.updateSaveState(),
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
  updateSaveState: () => appState.updateSaveState(),
  setEditorStatus,
  invalidatePreview: () => appState.invalidatePreviewForBoundsChange(),
});
appState = createAppStateModel({
  editorStatus: elements.editorStatus,
  fallbackDocumentName: () => currentExample(activeExampleId).name,
  healthCheckMode: () => healthCheckMode,
  codeEditor: () => codeEditor,
  graphInspector: () => graphInspector,
  graphInteraction: () => graphInteractionController,
  sourceWorkspace: () => sourceWorkspace,
  sourceCompile: sourceCompileController,
  sourceEditor: sourceEditorController,
  editorView: editorViewController,
  previewBounds: previewBoundsController,
  previewViewport,
  previewSettingsElements: {
    stepsInput: elements.stepsInput,
    stepsOutput: elements.stepsOutput,
    gridInput: elements.gridInput,
    gridOutput: elements.gridOutput,
  },
});
const appHealthDiagnostics = createAppHealthDiagnosticsReader({
  monitor: appHealthMonitor,
  elements: elements.appHealth,
  shortcuts: {
    prettify: SOURCE_PRETTIFY_SHORTCUT,
    graphFilter: GRAPH_FILTER_SHORTCUTS,
  },
  readState: appState.readAppHealthDiagnosticsState,
});
const browserSessionController = createBrowserSessionBridge({
  elements: elements.browserSession,
  canvas: elements.canvas,
  editorStatus: elements.editorStatus,
  previewViewport,
  codeEditor: () => codeEditor,
  readDiagnostics: appHealthDiagnostics,
  currentDocumentName: appState.currentDocumentName,
  currentSource: appState.currentSourceValue,
  sourceValid: () => sourceCompileController.sourceValid,
  clearPendingCompile: sourceEditorController.clearPendingCompile,
  preserveHiddenNodeKeys: () => graphInteractionController?.preserveHiddenNodeKeys(),
  updateSaveState: appState.updateSaveState,
  compileAgentUpdate: () => sourceCompileController.compile({ status: "Agent update" }),
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
  updateSaveState: appState.updateSaveState,
  setEditorStatus,
  afterBrowserFrame,
});
const sourceWorkspaceSession = createSourceWorkspaceSession({
  elements: elements.sourceWorkspace,
  initialName: currentExample(activeExampleId).name,
  initialSource: sourceForExample(activeExampleId),
  initialPreview: appState.currentPreviewProfile(),
  currentSource: appState.currentSourceValue,
  currentPreview: appState.currentPreviewProfile,
  previewSnapshot: previewProfileSnapshot,
  activeExampleId: () => activeExampleId,
  canSave: () => previewBoundsController.valid,
  confirm: (message) => window.confirm(message),
});
sourceWorkspace = sourceWorkspaceSession;
const sourceWorkspaceActions = createSourceWorkspaceActions({
  elements: elements.sourceWorkspaceActions,
  session: sourceWorkspaceSession,
  activeExampleId: () => activeExampleId,
  setActiveExampleId: (id) => {
    activeExampleId = id;
  },
  codeEditor: () => codeEditor,
  applyExampleBounds: (id) => previewBoundsController.applyExampleBounds(id),
  applyPreviewProfile: appState.applyPreviewProfile,
  clearPendingHiddenNodeKeys: () => graphInteractionController?.clearPendingHiddenNodeKeys(),
  resetLoadedSourceState: () => graphInteractionController?.resetLoadedSourceState(),
  clearPendingSourceCompile: sourceEditorController.clearPendingCompile,
  compileSource: sourceCompileController.compile,
  currentSourceCompilesForSave: sourceEditorController.currentSourceCompilesForSave,
  currentDocumentName: appState.currentDocumentName,
  currentPreviewProfile: appState.currentPreviewProfile,
  boundsAreValid: () => previewBoundsController.valid,
  setEditorStatus,
  afterBrowserFrame,
  confirm: (message) => window.confirm(message),
});

browserSessionController.configure();
configureGraphHistoryShortcutButtons(elements.graphHistory.undoButton, elements.graphHistory.redoButton);
elements.apiStat.textContent = `${Object.values(supportedSummary).reduce((a, b) => a + b, 0)} supported; excludes ${unsupportedOriginalApi.length}`;
appState.updateSaveState();
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
    sourceWorkspaceSession.setDraftPersistenceEnabled(!healthCheckMode);
    appState.updateSaveState();
    browserSessionController.connect();
  } catch (error) {
    elements.gpuBadge.textContent = "Preview error";
    elements.gpuBadge.classList.add("warn");
    elements.overlay.textContent = error instanceof Error ? error.message : String(error);
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!appState.hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = "";
}

function setEditorStatus(message: string, state: EditorStatusState): void {
  elements.editorStatus.textContent = message;
  if (state === "idle") elements.editorStatus.removeAttribute("data-state");
  else elements.editorStatus.dataset.state = state;
  elements.editorStatus.title = message;
}
