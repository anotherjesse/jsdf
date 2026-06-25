import type { SDF3 } from "./core/nodes";
import { findGraphSourceLinks } from "./editor/clean-source-patch";
import type { CodeEditor } from "./editor/code-editor";
import { evaluateSource } from "./editor/evaluate-source";
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
import { sourceDiagnosticFromError } from "./editor/source-diagnostics";
import {
  createSourceEditorController,
  type EditorStatusState,
  type SourceCompileOptions,
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

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const viewLabels = document.querySelector<HTMLElement>("#viewLabels")!;
const documentNameInput = document.querySelector<HTMLInputElement>("#documentNameInput")!;
const dirtyIndicator = document.querySelector<HTMLElement>("#dirtyIndicator")!;
const loadSourceButton = document.querySelector<HTMLButtonElement>("#loadSourceButton")!;
const saveSourceButton = document.querySelector<HTMLButtonElement>("#saveSourceButton")!;
const prettifySourceButton = document.querySelector<HTMLButtonElement>("#prettifySourceButton")!;
const sourceHintsButton = document.querySelector<HTMLButtonElement>("#sourceHintsButton")!;
const sourceDialog = document.querySelector<HTMLDialogElement>("#sourceDialog")!;
const sourceDialogList = document.querySelector<HTMLElement>("#sourceDialogList")!;
const closeSourceDialogButton = document.querySelector<HTMLButtonElement>("#closeSourceDialogButton")!;
const gpuBadge = document.querySelector<HTMLElement>("#gpuBadge")!;
const shaderViewButton = document.querySelector<HTMLButtonElement>("#shaderViewButton")!;
const meshViewButton = document.querySelector<HTMLButtonElement>("#meshViewButton")!;
const layoutViewButton = document.querySelector<HTMLButtonElement>("#layoutViewButton")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#downloadButton")!;
const surfaceNetButton = document.querySelector<HTMLButtonElement>("#surfaceNetButton")!;
const tetraMeshButton = document.querySelector<HTMLButtonElement>("#tetraMeshButton")!;
const fitBoundsButton = document.querySelector<HTMLButtonElement>("#fitBoundsButton")!;
const codeModeButton = document.querySelector<HTMLButtonElement>("#codeModeButton")!;
const graphModeButton = document.querySelector<HTMLButtonElement>("#graphModeButton")!;
const selectionFocusButton = document.querySelector<HTMLButtonElement>("#selectionFocusButton")!;
const codePanel = document.querySelector<HTMLElement>("#codePanel")!;
const graphPanel = document.querySelector<HTMLElement>("#graphPanel")!;
const codeEditorElement = document.querySelector<HTMLElement>("#codeEditor")!;
const graphInspectorElement = document.querySelector<HTMLElement>("#graphInspector")!;
const editorStatus = document.querySelector<HTMLElement>("#editorStatus")!;
const undoGraphButton = document.querySelector<HTMLButtonElement>("#undoGraphButton")!;
const redoGraphButton = document.querySelector<HTMLButtonElement>("#redoGraphButton")!;
const resetGraphButton = document.querySelector<HTMLButtonElement>("#resetGraphButton")!;
const graphChangeJournal = document.querySelector<HTMLElement>("#graphChangeJournal")!;
const stepsInput = document.querySelector<HTMLInputElement>("#stepsInput")!;
const stepsOutput = document.querySelector<HTMLOutputElement>("#stepsOutput")!;
const gridInput = document.querySelector<HTMLInputElement>("#gridInput")!;
const gridOutput = document.querySelector<HTMLOutputElement>("#gridOutput")!;
const boundsEditorElement = document.querySelector<HTMLElement>("#boundsEditor")!;
const previewStat = document.querySelector<HTMLElement>("#previewStat")!;
const meshStat = document.querySelector<HTMLElement>("#meshStat")!;
const triangleStat = document.querySelector<HTMLElement>("#triangleStat")!;
const apiStat = document.querySelector<HTMLElement>("#apiStat")!;
const sessionStrip = document.querySelector<HTMLElement>("#sessionStrip")!;
const sessionIdLabel = document.querySelector<HTMLElement>("#sessionIdLabel")!;
const copyAgentPromptButton = document.querySelector<HTMLButtonElement>("#copyAgentPromptButton")!;
const sessionSnapshotButton = document.querySelector<HTMLButtonElement>("#sessionSnapshotButton")!;
const sessionStatus = document.querySelector<HTMLElement>("#sessionStatus")!;
const overlay = document.querySelector<HTMLElement>("#overlay")!;

let codeEditor: CodeEditor | null = null;
let graphInspector: GraphInspector | null = null;
let graphInteractionController: GraphInteractionController | null = null;
let activeSdf: SDF3 | null = null;
let activeExampleId = examples[0]?.id ?? "canonical";
let editorSourceValid = true;
const appHealthMonitor = installAppHealthMonitor();
const healthCheckMode = new URLSearchParams(window.location.search).has("app-health-check");
const activeBrowserSessionId = sessionIdFromLocation();
const editorPreferences = loadEditorPreferences();
const sourceEditorController = createSourceEditorController({
  elements: {
    prettifyButton: prettifySourceButton,
    sourceHintsButton,
  },
  initialGraphHintsEnabled: editorPreferences.graphHintsEnabled,
  codeEditor: () => codeEditor,
  sourceValid: () => editorSourceValid,
  preserveHiddenNodeKeys: () => graphInteractionController?.preserveHiddenNodeKeys(),
  clearSourceLinks: () => graphInteractionController?.clearSourceLinks(),
  updateSaveState,
  compileSource: compileEditorSource,
  setEditorStatus,
  savePreferences: saveEditorPreferences,
});
const editorViewController = createEditorViewController({
  elements: {
    codeModeButton,
    graphModeButton,
    selectionFocusButton,
    codePanel,
    graphPanel,
  },
  codeEditor: () => codeEditor,
  graphInspector: () => graphInspector,
  readSelectedTarget: () => graphInteractionController?.readSelectedEditorTarget() ?? { label: "", sourceLink: null, graphNode: null },
  flushPendingSourceCompile: sourceEditorController.flushPendingCompile,
  afterBrowserFrame,
  revealGraphSource: (link) => graphInteractionController?.revealGraphSource(link),
  revealSourceLinkInGraph: (link) => graphInteractionController?.handleSourceLinkSelect(link, { revealGraph: true }),
});
const previewViewport = createPreviewViewportController({
  elements: {
    canvas,
    viewLabels,
    shaderViewButton,
    meshViewButton,
    layoutViewButton,
    downloadButton,
    surfaceNetButton,
    tetraMeshButton,
    stepsInput,
    stepsOutput,
    gridInput,
    gridOutput,
    previewStat,
    meshStat,
    triangleStat,
    overlay,
  },
  readState: readPreviewViewportState,
  onPreviewSettingsChange: updateSaveState,
});
const previewBoundsController = createPreviewBoundsController({
  elements: {
    root: boundsEditorElement,
    fitButton: fitBoundsButton,
    overlay,
  },
  initialBounds: boundsForExample(activeExampleId),
  readActiveSdf: () => activeSdf,
  updateSaveState,
  setEditorStatus,
  invalidatePreview: invalidatePreviewForBoundsChange,
});
const appHealthDiagnostics = createAppHealthDiagnosticsReader({
  monitor: appHealthMonitor,
  elements: {
    selectionFocusButton,
    prettifySourceButton,
    loadSourceButton,
    saveSourceButton,
  },
  shortcuts: {
    prettify: SOURCE_PRETTIFY_SHORTCUT,
    graphFilter: GRAPH_FILTER_SHORTCUTS,
  },
  readState: readAppHealthDiagnosticsState,
});
const browserSessionController = createBrowserSessionController({
  sessionId: activeBrowserSessionId,
  elements: {
    strip: sessionStrip,
    idLabel: sessionIdLabel,
    copyAgentPromptButton,
    snapshotButton: sessionSnapshotButton,
    status: sessionStatus,
  },
  readStatus: readBrowserSessionStatus,
  readCode: currentSourceValue,
  setCode: applyBrowserSessionCode,
  captureScreenshot: captureBrowserSessionState,
  captureSnapshotState: captureBrowserSessionState,
});
const graphHistoryController = createGraphHistoryController({
  elements: {
    undoButton: undoGraphButton,
    redoButton: redoGraphButton,
    resetButton: resetGraphButton,
    journal: graphChangeJournal,
  },
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
  activeSdf: () => activeSdf,
  editorView: editorViewController,
  previewViewport,
  graphHistory: graphHistoryController,
  updateSaveState,
  setEditorStatus,
  afterBrowserFrame,
});
const sourceWorkspace = createSourceWorkspaceSession({
  elements: {
    documentNameInput,
    dirtyIndicator,
    saveButton: saveSourceButton,
  },
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
  elements: {
    dialog: sourceDialog,
    list: sourceDialogList,
    loadButton: loadSourceButton,
  },
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
  compileSource: compileEditorSource,
  currentSourceCompilesForSave: sourceEditorController.currentSourceCompilesForSave,
  currentDocumentName,
  currentPreviewProfile,
  boundsAreValid: () => previewBoundsController.valid,
  setEditorStatus,
  afterBrowserFrame,
  confirm: (message) => window.confirm(message),
});

browserSessionController.configure();
configureGraphHistoryShortcutButtons(undoGraphButton, redoGraphButton);
apiStat.textContent = `${Object.values(supportedSummary).reduce((a, b) => a + b, 0)} supported; excludes ${unsupportedOriginalApi.length}`;
updateSaveState();
sourceWorkspaceActions.renderDialog();
exposeAppHealthDiagnostics(appHealthDiagnostics);

loadSourceButton.addEventListener("click", sourceWorkspaceActions.openDialog);
saveSourceButton.addEventListener("click", sourceWorkspaceActions.saveCurrentSource);
closeSourceDialogButton.addEventListener("click", () => sourceDialog.close());
sourceDialog.addEventListener("click", (event) => {
  if (event.target === sourceDialog) sourceDialog.close();
});
sourceDialog.addEventListener("close", () => {
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
    gpuBadge.textContent = "WebGL preview";
    gpuBadge.classList.add("warn");
  } else {
    gpuBadge.textContent = "WebGL + WebGPU";
    gpuBadge.classList.add("ok");
  }

  try {
    previewViewport.initialize();
    graphInspector = new GraphInspector(graphInspectorElement, {
      onSelect: (node) => graphInteractionController?.selectNode(node),
      onHover: (node, options) => graphInteractionController?.handleGraphHover(node, options),
      onEdit: (edit) => graphInteractionController?.handleGraphEdit(edit),
      onSolo: (preview) => graphInteractionController?.handleSoloPreview(preview),
      onRevealSource: (link) => graphInteractionController?.revealGraphSource(link),
      onSourceHover: (link) => graphInteractionController?.handleGraphSourceHover(link),
      onVisibilityChange: (hiddenIds) => graphInteractionController?.handleGraphVisibilityChange(hiddenIds),
    });
    compileEditorSource({ status: "Ready", statusState: "idle", invalidateMesh: false });
    await previewViewport.renderCurrent();
    const { createCodeEditor } = await import("./editor/code-editor");
    codeEditor = createCodeEditor(
      codeEditorElement,
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
      const source = codeEditor.getValue();
      if (activeSdf) {
        graphInteractionController?.applyCompiledGraph({
          source,
          sdf: activeSdf,
          sourceLinks: findGraphSourceLinks(source, activeSdf),
          previousSelection: { source: null, node: null },
        });
      }
    }
    sourceWorkspace.setDraftPersistenceEnabled(!healthCheckMode);
    updateSaveState();
    browserSessionController.connect();
  } catch (error) {
    gpuBadge.textContent = "Preview error";
    gpuBadge.classList.add("warn");
    overlay.textContent = error instanceof Error ? error.message : String(error);
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
  compileEditorSource({ status: comment ? "Agent update" : "Agent update" });
  return captureBrowserSessionState();
}

async function captureBrowserSessionState(): Promise<BrowserSessionCommandResult> {
  await renderShaderPreviewForSession();
  return {
    code: currentSourceValue(),
    sourceValid: editorSourceValid,
    status: editorStatus.textContent ?? "",
    viewMode: previewViewport.viewMode,
    previewLayout: previewViewport.previewLayout,
    screenshotDataUrl: canvas.toDataURL("image/png"),
  };
}

async function renderShaderPreviewForSession(): Promise<void> {
  await previewViewport.renderShaderPreviewForSession(editorSourceValid, waitForBrowserFrame);
}

function waitForBrowserFrame(): Promise<void> {
  return new Promise((resolve) => afterBrowserFrame(resolve));
}

function compileEditorSource(
  options: SourceCompileOptions = { status: "Compiled" },
): boolean {
  const source = codeEditor?.getValue() ?? sourceForExample(activeExampleId);
  const previousSelection = graphInteractionController?.captureSelectionIdentity() ?? { source: null, node: null };
  try {
    const { sdf } = evaluateSource(source);
    const sourceLinks = findGraphSourceLinks(source, sdf);
    editorSourceValid = true;
    activeSdf = sdf;
    graphInteractionController?.applyCompiledGraph({
      source,
      sdf,
      sourceLinks,
      previousSelection,
    });
    setEditorStatus(options.status, options.statusState ?? "ok");
    if (options.invalidateMesh !== false) previewViewport.invalidateMeshForActiveSdf();
    updateSaveState();
    previewViewport.schedulePreview(0);
    return true;
  } catch (error) {
    const diagnostic = sourceDiagnosticFromError(error, source);
    codeEditor?.setError(diagnostic);
    graphInteractionController?.handleCompileError();
    editorSourceValid = false;
    setEditorStatus(diagnostic.message, "error");
    overlay.textContent = `Code error: ${diagnostic.message}`;
    return false;
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!sourceWorkspace.hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "";
}

function setEditorStatus(message: string, state: EditorStatusState): void {
  editorStatus.textContent = message;
  if (state === "idle") editorStatus.removeAttribute("data-state");
  else editorStatus.dataset.state = state;
  editorStatus.title = message;
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
    ready: Boolean(codeEditor && graphInspector && activeSdf && previewViewport.ready),
    editorReady: Boolean(codeEditor),
    graphReady: Boolean(graphInspector),
    activeSdfReady: Boolean(activeSdf),
    healthCheckMode,
    dirty: sourceWorkspace.hasUnsavedChanges,
    status: editorStatus.textContent ?? "",
    sourceCompilePending: sourceEditorController.sourceCompilePending,
    sourceValid: editorSourceValid,
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
    activeSdf,
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
  return codeEditor?.getValue() ?? sourceForExample(activeExampleId);
}

function updateSaveState(): void {
  sourceWorkspace.updateSaveState();
}

function applyPreviewProfile(profile: PreviewProfile): void {
  previewBoundsController.applyProfileBounds(profile.bounds);
  graphInteractionController?.applyPendingHiddenNodeKeys(profile.hiddenNodeKeys ?? []);
  previewViewport.applyRange(stepsInput, stepsOutput, profile.raySteps);
  previewViewport.applyRange(gridInput, gridOutput, profile.meshGrid);
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
