import type { Node, SDF3 } from "./core/nodes";
import { createBoundsEditor, type BoundsEditor } from "./editor/bounds-editor";
import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceEdit, type GraphSourceLink } from "./editor/clean-source-patch";
import type { CodeEditor, SourceLinkHoverOptions, SourceLinkSelectOptions, SourceLinkValueChangeOptions } from "./editor/code-editor";
import { evaluateSource } from "./editor/evaluate-source";
import {
  createAppHealthDiagnosticsReader,
  exposeAppHealthDiagnostics,
  installAppHealthMonitor,
  type AppHealthDiagnosticsState,
} from "./editor/app-health";
import {
  configureEditorModeShortcutButtons,
  configureGraphHistoryShortcutButtons,
  GRAPH_FILTER_SHORTCUTS,
  installAppKeyboardShortcuts,
  SELECTED_TARGET_SHORTCUTS,
  SOURCE_HINTS_SHORTCUT,
  SOURCE_PRETTIFY_SHORTCUT,
  type AppShortcutEditorView,
} from "./editor/app-shortcuts";
import {
  sessionIdFromLocation,
  type BrowserSessionCommandResult,
} from "./editor/browser-session";
import { createBrowserSessionController } from "./editor/browser-session-controller";
import { loadEditorPreferences, saveEditorPreferences } from "./editor/editor-preferences";
import { sourceForExample } from "./editor/example-source";
import { createGraphHistoryController, type GraphHistoryEntry } from "./editor/graph-history-controls";
import { GraphInspector, type GraphHoverOptions, type GraphParamEdit } from "./editor/graph-inspector";
import { prettifySource } from "./editor/prettify-source";
import { sourceDiagnosticFromError } from "./editor/source-diagnostics";
import {
  graphNodeSourceIdentityForNode,
  graphSourceLinkIdentityForLink,
  sourceLinkForGraphNodeIdentity,
  sourceLinkForGraphSourceLinkIdentity,
  type GraphNodeSourceIdentity,
  type GraphSourceLinkIdentity,
} from "./editor/graph-source-identity";
import {
  boundsForExample,
  cloneBounds,
  createPreviewProfile,
  hiddenNodeIdsFromKeys,
  hiddenNodeKeysForGraph,
  previewProfileSnapshot,
  type PreviewProfile,
} from "./editor/preview-profile";
import type { SoloPreview } from "./editor/solo-preview";
import { renderSourceDialog } from "./editor/source-dialog";
import { buildVisibleSdf } from "./editor/visible-sdf";
import {
  clearSourceDraft,
  deleteSavedSourceDocument,
  deleteSavedSourceVersion,
  latestSourceVersion,
  listSavedSourceDocuments,
  loadSourceDraft,
  loadSavedSourceVersion,
  saveSourceDraft,
  saveSourceVersion,
  type SavedSourceDocument,
} from "./editor/workspace-storage";
import { supportedSummary, unsupportedOriginalApi } from "./api/completeness";
import { currentExample, examples } from "./examples";
import { hasWebGPU } from "./gpu/webgpu";
import { estimateBounds, paddedBounds, type Bounds3 } from "./mesh/bounds";
import { binarySTL, downloadBlob, generateMesh, type MeshAlgorithm, type MeshResult } from "./mesh/generate";
import { OrbitCamera } from "./preview/orbit-camera";
import { viewPanels, type PreviewLayout } from "./preview/view-layout";
import { WebGLMeshRenderer } from "./preview/webgl-mesh-renderer";
import { WebGLRaymarchRenderer } from "./preview/webgl-raymarch-renderer";

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

type RenderView = "shader" | "mesh";
type EditorView = AppShortcutEditorView;
type EditorStatusState = "idle" | "ok" | "pending" | "error";

let rayRenderer: WebGLRaymarchRenderer | null = null;
let meshRenderer: WebGLMeshRenderer | null = null;
let codeEditor: CodeEditor | null = null;
let graphInspector: GraphInspector | null = null;
let activeSdf: SDF3 | null = null;
let selectedNode: Node | null = null;
let hoveredNode: Node | null = null;
let focusPreview: SoloPreview | null = null;
let soloPreview: SoloPreview | null = null;
let hiddenNodeIds = new Set<number>();
let currentSourceLinks: readonly GraphSourceLink[] = [];
let selectedSourceLink: GraphSourceLink | null = null;
let pendingHiddenNodeKeys: readonly string[] = [];
let boundsEditor: BoundsEditor | null = null;
let mesh: MeshResult | null = null;
let meshBuildPromise: Promise<void> | null = null;
let lastBlob: Blob | null = null;
let renderJob = 0;
let meshJob = 0;
let previewTimer = 0;
let meshTimer = 0;
let sourceCompileTimer = 0;
let viewMode: RenderView = "shader";
let desiredViewMode: RenderView = "shader";
let previewLayout: PreviewLayout = "single";
let meshAlgorithm: MeshAlgorithm = "surface-net";
let editorView: EditorView = "code";
let activeExampleId = examples[0]?.id ?? "canonical";
let activeBounds = boundsForExample(activeExampleId);
let boundsAreValid = true;
let activeDocumentId: string | null = null;
let activeSourceVersionId: string | null = null;
let activeSourceName = currentExample(activeExampleId).name;
let graphHistoryHoverKey: string | null = null;
let cleanSourceSnapshot = sourceForExample(activeExampleId);
let cleanNameSnapshot = activeSourceName;
let cleanPreviewSnapshot = "";
let hasUnsavedChanges = false;
let draftPersistenceEnabled = false;
let editorSourceValid = true;
const appHealthMonitor = installAppHealthMonitor();
const healthCheckMode = new URLSearchParams(window.location.search).has("app-health-check");
const activeBrowserSessionId = sessionIdFromLocation();
const editorPreferences = loadEditorPreferences();
let graphHintsEnabled = editorPreferences.graphHintsEnabled;
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
    syncCodeFromGraphEdit(entry, value);
  },
  onMutationStatus: applyGraphMutationStatus,
  onDirtyEntriesChange: (entries) => graphInspector?.setDirtyParams(entries),
  onBeforeRenderJournal: () => {
    graphHistoryHoverKey = null;
  },
  sourceLinkForEntry: (entry) => sourceLinkForGraphEdit(currentSourceLinks, entry),
  selectedEntry: (entry) => sourceLinksEqual(sourceLinkForGraphEdit(currentSourceLinks, entry), selectedSourceLink),
  onSelectEntry: selectGraphHistoryEntry,
  onHoverEntry: hoverGraphHistoryEntry,
  onClearEntryHover: clearGraphHistoryEntryHover,
});

browserSessionController.configure();
configureEditorModeShortcutButtons(codeModeButton, graphModeButton);
configureGraphHistoryShortcutButtons(undoGraphButton, redoGraphButton);
apiStat.textContent = `${Object.values(supportedSummary).reduce((a, b) => a + b, 0)} supported; excludes ${unsupportedOriginalApi.length}`;
stepsOutput.value = stepsInput.value;
gridOutput.value = gridInput.value;
documentNameInput.value = activeSourceName;
boundsEditor = createBoundsEditor(boundsEditorElement, activeBounds, {
  onChange: handleBoundsChange,
  onInvalid: handleBoundsInvalid,
});
cleanPreviewSnapshot = previewProfileSnapshot(currentPreviewProfile());
updateSourceHintsButton();
updateSaveState();
renderLoadDialog();
exposeAppHealthDiagnostics(appHealthDiagnostics);

stepsInput.addEventListener("input", () => {
  stepsOutput.value = stepsInput.value;
  updateSaveState();
  schedulePreview();
});
gridInput.addEventListener("input", () => {
  gridOutput.value = gridInput.value;
  updateSaveState();
  if (viewMode === "mesh") {
    clearMesh({ keepView: true, meshStatText: "queued" });
    scheduleMeshBuild();
  } else {
    clearMesh();
  }
});
shaderViewButton.addEventListener("click", () => {
  desiredViewMode = "shader";
  window.clearTimeout(meshTimer);
  setViewMode("shader");
});
meshViewButton.addEventListener("click", () => {
  desiredViewMode = "mesh";
  void showMesh();
});
layoutViewButton.addEventListener("click", () => {
  setPreviewLayout(previewLayout === "single" ? "quad" : "single");
});
surfaceNetButton.addEventListener("click", () => setMeshAlgorithm("surface-net"));
tetraMeshButton.addEventListener("click", () => setMeshAlgorithm("tetra"));
fitBoundsButton.addEventListener("click", fitBoundsToCurrentSdf);
downloadButton.addEventListener("click", () => {
  if (lastBlob) downloadBlob(lastBlob, `${slugify(currentDocumentName())}.stl`);
});
documentNameInput.addEventListener("input", updateSaveState);
loadSourceButton.addEventListener("click", openSourceDialog);
saveSourceButton.addEventListener("click", saveCurrentSource);
prettifySourceButton.addEventListener("click", prettifyCurrentSource);
sourceHintsButton.addEventListener("click", toggleGraphHints);
closeSourceDialogButton.addEventListener("click", () => sourceDialog.close());
sourceDialog.addEventListener("click", (event) => {
  if (event.target === sourceDialog) sourceDialog.close();
});
sourceDialog.addEventListener("close", () => {
  restoreSourceDialogFocus();
  afterBrowserFrame(restoreSourceDialogFocus);
});
codeModeButton.addEventListener("click", () => setEditorView("code"));
graphModeButton.addEventListener("click", () => setEditorView("graph"));
selectionFocusButton.addEventListener("click", revealSelectedTarget);
window.addEventListener("resize", () => {
  activeRenderer()?.redraw();
  renderViewLabels();
});
installAppKeyboardShortcuts(window, {
  editorView: () => editorView,
  selectionFocusVisible: () => !selectionFocusButton.hidden,
  revealSelectedTarget,
  setEditorView,
  focusGraphFilter: () => graphInspector?.focusFilter({ select: true }),
  toggleSourceHints: toggleGraphHints,
  prettifySource: prettifyCurrentSource,
  openSourceDialog,
  saveSource: saveCurrentSourceFromShortcut,
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
    const camera = new OrbitCamera(canvas, () => activeRenderer()?.redraw());
    rayRenderer = new WebGLRaymarchRenderer(canvas, camera);
    meshRenderer = new WebGLMeshRenderer(canvas, camera);
    setPreviewLayout(previewLayout, { recordChange: false });
    graphInspector = new GraphInspector(graphInspectorElement, {
      onSelect: selectNode,
      onHover: handleGraphHover,
      onEdit: handleGraphEdit,
      onSolo: handleSoloPreview,
      onRevealSource: revealGraphSource,
      onSourceHover: handleGraphSourceHover,
      onVisibilityChange: handleGraphVisibilityChange,
    });
    setViewMode("shader");
    compileEditorSource({ status: "Ready", statusState: "idle", invalidateMesh: false });
    await renderCurrent();
    const { createCodeEditor } = await import("./editor/code-editor");
    codeEditor = createCodeEditor(
      codeEditorElement,
      sourceForExample(activeExampleId),
      scheduleSourceCompile,
      handleSourceLinkSelect,
      handleSourceLinkValueChange,
      handleSourceLinkHover,
      handleSourceLinkCursor,
      prettifyCurrentSource,
    );
    codeEditor.setGraphHintsEnabled(graphHintsEnabled);
    if (healthCheckMode || !restoreSourceDraft()) refreshSourceLinks();
    draftPersistenceEnabled = !healthCheckMode;
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
  clearPendingSourceCompile();
  pendingHiddenNodeKeys = hiddenNodeKeysForCurrentGraph();
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
    viewMode,
    previewLayout,
    screenshotDataUrl: canvas.toDataURL("image/png"),
  };
}

async function renderShaderPreviewForSession(): Promise<void> {
  desiredViewMode = "shader";
  window.clearTimeout(meshTimer);
  setViewMode("shader");
  window.clearTimeout(previewTimer);
  previewTimer = 0;
  if (editorSourceValid) await renderCurrent();
  else activeRenderer()?.redraw();
  await waitForBrowserFrame();
}

function waitForBrowserFrame(): Promise<void> {
  return new Promise((resolve) => afterBrowserFrame(resolve));
}

function setGraphHintsEnabled(enabled: boolean): void {
  graphHintsEnabled = enabled;
  codeEditor?.setGraphHintsEnabled(enabled);
  updateSourceHintsButton();
  saveEditorPreferences({ graphHintsEnabled });
}

function toggleGraphHints(): void {
  setGraphHintsEnabled(!graphHintsEnabled);
  setEditorStatus(graphHintsEnabled ? "Graph hints shown" : "Graph hints hidden", "idle");
}

function updateSourceHintsButton(): void {
  sourceHintsButton.setAttribute("aria-pressed", String(graphHintsEnabled));
  sourceHintsButton.setAttribute("aria-keyshortcuts", SOURCE_HINTS_SHORTCUT);
  sourceHintsButton.title = `${graphHintsEnabled ? "Hide" : "Show"} graph hints (${SOURCE_HINTS_SHORTCUT})`;
}

function loadExample(id: string): void {
  if (!confirmDiscardUnsavedChanges()) return;
  clearPendingSourceCompile();
  activeExampleId = id;
  activeBounds = boundsForExample(id);
  boundsAreValid = true;
  boundsEditor?.setBounds(activeBounds);
  activeDocumentId = null;
  activeSourceVersionId = null;
  activeSourceName = currentExample(id).name;
  const source = sourceForExample(id);
  documentNameInput.value = activeSourceName;
  selectedNode = null;
  selectedSourceLink = null;
  hoveredNode = null;
  focusPreview = null;
  hiddenNodeIds = new Set();
  pendingHiddenNodeKeys = [];
  codeEditor?.setValue(source);
  markSourceClean(source, activeSourceName);
  renderLoadDialog();
  sourceDialog.close();
  compileEditorSource({ status: "Ready", statusState: "idle" });
}

function loadSavedSourceById(documentId: string, versionId: string): void {
  if (!confirmDiscardUnsavedChanges()) return;
  const loaded = loadSavedSourceVersion(documentId, versionId);
  if (!loaded) {
    setEditorStatus("Saved source not found", "error");
    return;
  }
  loadSavedSource(loaded.document, loaded.version.id, loaded.version.source, loaded.version.preview);
}

function loadSavedSource(document: SavedSourceDocument, versionId: string, source: string, preview?: PreviewProfile): void {
  clearPendingSourceCompile();
  activeDocumentId = document.id;
  activeSourceVersionId = versionId;
  activeSourceName = document.name;
  if (preview) applyPreviewProfile(preview);
  else pendingHiddenNodeKeys = [];
  documentNameInput.value = document.name;
  selectedNode = null;
  selectedSourceLink = null;
  hoveredNode = null;
  focusPreview = null;
  hiddenNodeIds = new Set();
  codeEditor?.setValue(source);
  markSourceClean(source, document.name);
  renderLoadDialog();
  sourceDialog.close();
  compileEditorSource({ status: "Ready", statusState: "idle" });
}

function restoreSourceDraft(): boolean {
  if (!codeEditor) return false;
  const draft = loadSourceDraft();
  if (!draft) return false;

  clearPendingSourceCompile();
  if (examples.some((example) => example.id === draft.activeExampleId)) {
    activeExampleId = draft.activeExampleId;
  }
  activeDocumentId = draft.activeDocumentId;
  activeSourceVersionId = draft.activeVersionId;
  activeSourceName = draft.name;
  documentNameInput.value = draft.name;
  if (draft.preview) {
    applyPreviewProfile(draft.preview);
  } else {
    pendingHiddenNodeKeys = [];
    activeBounds = boundsForExample(activeExampleId);
    boundsAreValid = true;
    boundsEditor?.setBounds(activeBounds);
  }
  selectedNode = null;
  selectedSourceLink = null;
  hoveredNode = null;
  focusPreview = null;
  hiddenNodeIds = new Set();
  codeEditor.setValue(draft.source);
  renderLoadDialog();
  compileEditorSource({ status: "Recovered draft", statusState: "pending" });
  return true;
}

function saveCurrentSource(): void {
  if (!currentSourceCompilesForSave()) return;

  const source = codeEditor?.getValue() ?? sourceForExample(activeExampleId);
  try {
    const saved = saveSourceVersion(currentDocumentName(), source, activeDocumentId, currentPreviewProfile());
    const latest = latestSourceVersion(saved);
    activeDocumentId = saved.id;
    activeSourceVersionId = latest?.id ?? null;
    activeSourceName = saved.name;
    documentNameInput.value = saved.name;
    markSourceClean(source, saved.name);
    renderLoadDialog();
    setEditorStatus("Saved", "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setEditorStatus(`Save failed: ${message}`, "error");
  }
}

function saveCurrentSourceFromShortcut(): void {
  if (!boundsAreValid) {
    setEditorStatus("Fix bounds before saving", "error");
    return;
  }
  if (!hasUnsavedChanges) {
    setEditorStatus("No changes to save", "idle");
    return;
  }
  saveCurrentSource();
}

function currentSourceCompilesForSave(): boolean {
  if (sourceCompileTimer) return flushPendingSourceCompile();
  if (editorSourceValid) return true;
  setEditorStatus("Fix code before saving", "error");
  return false;
}

function prettifyCurrentSource(): void {
  if (!codeEditor) return;
  const source = codeEditor.getValue();
  const nextSource = prettifySource(source);
  if (nextSource === source) {
    setEditorStatus("Already pretty", "idle");
    return;
  }
  clearPendingSourceCompile();
  pendingHiddenNodeKeys = hiddenNodeKeysForCurrentGraph();
  codeEditor.setValue(nextSource);
  updateSaveState();
  compileEditorSource({ status: "Prettified" });
}

function deleteSavedDocument(documentId: string): void {
  const savedDocument = listSavedSourceDocuments().find((candidate) => candidate.id === documentId);
  if (!savedDocument) {
    renderLoadDialog();
    return;
  }
  if (!window.confirm(`Delete "${savedDocument.name}" and all of its saved versions?`)) return;

  if (!deleteSavedSourceDocument(documentId)) {
    setEditorStatus("Saved shape not found", "error");
    renderLoadDialog();
    return;
  }

  if (activeDocumentId === documentId) detachDeletedSource();
  renderLoadDialog();
  setEditorStatus("Deleted saved shape", "ok");
}

function deleteSavedVersion(documentId: string, versionId: string): void {
  const loaded = loadSavedSourceVersion(documentId, versionId);
  if (!loaded) {
    renderLoadDialog();
    return;
  }
  if (!window.confirm(`Delete this saved version of "${loaded.document.name}"?`)) return;

  deleteSavedSourceVersion(documentId, versionId);
  if (activeDocumentId === documentId && activeSourceVersionId === versionId) detachDeletedSource();
  renderLoadDialog();
  setEditorStatus("Deleted saved version", "ok");
}

function scheduleSourceCompile(): void {
  clearPendingSourceCompile();
  pendingHiddenNodeKeys = hiddenNodeKeysForCurrentGraph();
  updateSaveState();
  setEditorStatus("Editing...", "pending");
  codeEditor?.setSourceLinks([]);
  graphInspector?.setSourceLinks([]);
  sourceCompileTimer = window.setTimeout(() => {
    sourceCompileTimer = 0;
    compileEditorSource({ status: "Compiled" });
  }, 350);
}

function clearPendingSourceCompile(): void {
  if (!sourceCompileTimer) return;
  window.clearTimeout(sourceCompileTimer);
  sourceCompileTimer = 0;
}

function flushPendingSourceCompile(): boolean {
  if (!sourceCompileTimer) return editorSourceValid;
  clearPendingSourceCompile();
  return compileEditorSource({ status: "Compiled" });
}

function compileEditorSource(
  options: { status: string; statusState?: EditorStatusState; invalidateMesh?: boolean } = { status: "Compiled" },
): boolean {
  const source = codeEditor?.getValue() ?? sourceForExample(activeExampleId);
  const previousSelectedSourceIdentity = selectedSourceLink
    ? graphSourceLinkIdentityForLink(currentSourceLinks, selectedSourceLink)
    : null;
  const previousSelectedIdentity = selectedNode && !isActiveRootNode(selectedNode)
    ? graphNodeSourceIdentityForNode(currentSourceLinks, selectedNode.id)
    : null;
  try {
    const { sdf } = evaluateSource(source);
    const sourceLinks = findGraphSourceLinks(source, sdf);
    const restoredHiddenNodeIds = hiddenNodeIdsFromKeys(pendingHiddenNodeKeys, sourceLinks, sdf);
    pendingHiddenNodeKeys = [];
    soloPreview = null;
    focusPreview = null;
    hiddenNodeIds = new Set(restoredHiddenNodeIds);
    editorSourceValid = true;
    activeSdf = sdf;
    currentSourceLinks = sourceLinks;
    graphInspector?.setSdf(sdf, restoredHiddenNodeIds);
    codeEditor?.setError(null);
    refreshSourceLinks(source, sdf, sourceLinks);
    restoreSelectedGraphSelection(previousSelectedSourceIdentity, previousSelectedIdentity, sourceLinks);
    graphHistoryController.clear();
    setEditorStatus(options.status, options.statusState ?? "ok");
    if (options.invalidateMesh !== false) invalidateMeshForActiveSdf();
    updateSaveState();
    schedulePreview(0);
    return true;
  } catch (error) {
    const diagnostic = sourceDiagnosticFromError(error, source);
    codeEditor?.setError(diagnostic);
    codeEditor?.setSourceLinks([]);
    graphInspector?.setSourceLinks([]);
    currentSourceLinks = [];
    selectedSourceLink = null;
    editorSourceValid = false;
    setEditorStatus(diagnostic.message, "error");
    overlay.textContent = `Code error: ${diagnostic.message}`;
    return false;
  }
}

function restoreSelectedGraphSelection(
  sourceIdentity: GraphSourceLinkIdentity | null,
  nodeIdentity: GraphNodeSourceIdentity | null,
  sourceLinks: readonly GraphSourceLink[],
): void {
  const sourceLink = sourceIdentity ? sourceLinkForGraphSourceLinkIdentity(sourceLinks, sourceIdentity) : null;
  if (sourceLink && selectRestoredSourceLink(sourceLink)) return;
  restoreSelectedGraphNode(nodeIdentity, sourceLinks);
}

function restoreSelectedGraphNode(
  identity: GraphNodeSourceIdentity | null,
  sourceLinks: readonly GraphSourceLink[],
): void {
  if (!identity || !graphInspector) return;
  const link = sourceLinkForGraphNodeIdentity(sourceLinks, identity);
  if (!link) return;
  selectRestoredSourceLink(link);
}

function selectRestoredSourceLink(link: GraphSourceLink): boolean {
  if (!graphInspector) return false;
  const node = graphInspector.selectNodeById(link.nodeId);
  if (!node) return false;
  setSelectedSourceLink(link);
  return true;
}

function handleSourceLinkSelect(link: GraphSourceLink, options: SourceLinkSelectOptions = {}): void {
  handleSourceLinkCursor(link);
  if (!options.revealGraph) return;
  setEditorView("graph");
  window.setTimeout(() => graphInspector?.revealSelected({ focus: true }), 0);
}

function handleSourceLinkCursor(link: GraphSourceLink | null): void {
  if (!link) {
    setSelectedSourceLink(null, { markCode: false });
    return;
  }
  const node = graphInspector?.selectNodeById(link.nodeId);
  if (!node) return;
  setSelectedSourceLink(link, { markCode: false });
  setEditorStatus(`${link.nodeKind} ${link.label}`, "ok");
  scheduleActivePreview(0);
}

function handleSourceLinkValueChange(
  link: GraphSourceLink,
  nextValue: number,
  options: SourceLinkValueChangeOptions = {},
): void {
  if (!graphInspector) return;
  const previousValue = graphInspector.getParamValue(link.nodeId, link.path);
  if (typeof previousValue !== "number" || previousValue === nextValue) return;
  const node = graphInspector.setParamValue(link.nodeId, link.path, nextValue);
  if (!node) return;
  handleGraphEdit({
    node,
    nodeId: node.id,
    nodeKind: node.kind,
    path: [...link.path],
    label: link.label,
    previousValue,
    nextValue,
    ...(options.editSessionId ? { editSessionId: options.editSessionId } : {}),
  });
}

function handleSourceLinkHover(link: GraphSourceLink | null, options: SourceLinkHoverOptions): void {
  if (!graphInspector) return;
  const before = previewHoverSignature();
  if (!link) {
    hoveredNode = null;
    focusPreview = null;
    graphInspector.setHoveredSourceLink(null);
    graphInspector.setHoveredNodeById(null);
    graphInspector.setFocusHoveredNodeById(null);
    if (soloPreview) handleSoloPreview(null);
    else schedulePreviewIfHoverChanged(before);
    const selected = graphInspector.getSelected();
    codeEditor?.setFocusedNode(selected?.id ?? null);
    return;
  }

  graphInspector.setHoveredSourceLink(link);
  const node = graphInspector.setHoveredNodeById(link.nodeId);
  hoveredNode = node;
  if (!node) {
    graphInspector.setFocusHoveredNodeById(null);
    return;
  }
  codeEditor?.setFocusedNode(node.id);

  if (options.shiftKey && isHighlightableNode(node)) {
    graphInspector.setFocusHoveredNodeById(node.id);
    focusPreview = graphInspector.buildSoloPreviewForNodeId(link.nodeId);
    schedulePreviewIfHoverChanged(before);
    return;
  }

  graphInspector.setFocusHoveredNodeById(null);
  focusPreview = null;
  if (soloPreview) handleSoloPreview(null);
  else schedulePreviewIfHoverChanged(before);
}

function handleGraphHover(node: Node | null, options: GraphHoverOptions): void {
  if (!graphInspector) return;
  const before = previewHoverSignature();
  hoveredNode = node;
  if (!node) {
    focusPreview = null;
    if (soloPreview) handleSoloPreview(null);
    else schedulePreviewIfHoverChanged(before);
    codeEditor?.setFocusedNode(selectedNode?.id ?? null);
    return;
  }

  codeEditor?.setFocusedNode(node.id);
  if (options.shiftKey && isHighlightableNode(node)) {
    focusPreview = graphInspector.buildSoloPreviewForNodeId(node.id);
    schedulePreviewIfHoverChanged(before);
    return;
  }

  focusPreview = null;
  if (soloPreview) handleSoloPreview(null);
  else schedulePreviewIfHoverChanged(before);
}

function previewHoverSignature(): string {
  return [
    hoveredNode?.id ?? "",
    focusPreview?.key ?? "",
    soloPreview?.key ?? "",
  ].join(":");
}

function schedulePreviewIfHoverChanged(before: string): void {
  if (previewHoverSignature() !== before) scheduleActivePreview(0);
}

function scheduleActivePreview(delay = 0): void {
  if (viewMode === "mesh" && !soloPreview) {
    updateMeshHighlight();
    return;
  }
  schedulePreview(delay);
}

function updateMeshHighlight(): void {
  if (!mesh || mesh.triangles.length === 0) return;
  const sdf = visibleActiveSdf();
  if (!sdf) return;
  const highlight = highlightForRender(null);
  meshRenderer?.setHighlight(sdf, highlight.node, highlight.mode);
  if (viewMode === "mesh") overlay.textContent = focusPreview ? previewOverlayText("Focus", focusPreview) : "";
}

function previewOverlayText(prefix: "Focus" | "Solo", preview: SoloPreview): string {
  return `${prefix}: ${preview.label}${preview.preservedWrappers ? ` (${preview.preservedWrappers} context)` : ""}`;
}

function revealGraphSource(link: GraphSourceLink): void {
  setEditorView("code");
  codeEditor?.setFocusedNode(link.nodeId);
  setSelectedSourceLink(link);
  afterBrowserFrame(() => {
    codeEditor?.revealSourceLink(link);
  });
  setEditorStatus(`${link.nodeKind} ${link.label}`, "ok");
}

function handleGraphSourceHover(link: GraphSourceLink | null): void {
  codeEditor?.markHoveredSourceLink(link);
}

function selectNode(node: Node | null): void {
  selectedNode = node;
  const sourceLink = node ? sourceLinkForNodeId(node.id) : null;
  setSelectedSourceLink(sourceLink);
  codeEditor?.setFocusedNode(node?.id ?? null, { reveal: editorView === "code" });
  if (node && activeSdf) {
    setEditorStatus(`${node.kind} #${node.id}`, "ok");
    scheduleActivePreview(0);
  }
}

function handleGraphEdit(edit: GraphParamEdit): void {
  if (!activeSdf) return;
  focusPreview = null;
  soloPreview = null;
  graphHistoryController.record(edit);
  applyGraphMutationStatus(`Edited ${edit.nodeKind} ${edit.label}`, edit, edit.nextValue);
}

function handleSoloPreview(preview: SoloPreview | null): void {
  focusPreview = null;
  soloPreview = preview;
  if (preview) {
    meshRenderer?.setActive(false);
    rayRenderer?.setActive(true);
    schedulePreview(0);
    return;
  }

  if (viewMode === "mesh") {
    rayRenderer?.setActive(false);
    meshRenderer?.setActive(true);
    meshRenderer?.redraw();
    setViewMode("mesh");
    return;
  }
  schedulePreview(0);
}

function handleGraphVisibilityChange(hiddenIds: readonly number[]): void {
  hiddenNodeIds = new Set(hiddenIds);
  focusPreview = null;
  soloPreview = null;
  updateSaveState();
  invalidateMeshForActiveSdf();
  schedulePreview(0);
}

function invalidateMeshForActiveSdf(): void {
  if (desiredViewMode === "mesh" || viewMode === "mesh") {
    clearMesh({ keepView: viewMode === "mesh", meshStatText: "queued" });
    scheduleMeshBuild();
    return;
  }
  clearMesh();
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "";
}

function applyGraphMutationStatus(message: string, edit?: GraphSourceEdit, value?: unknown): void {
  const synced = edit ? syncCodeFromGraphEdit(edit, value) : true;
  setEditorStatus(synced ? message : `${message} (preview only)`, synced ? "ok" : "pending");
  invalidateMeshForActiveSdf();
  schedulePreview(0);
}

function syncCodeFromGraphEdit(edit: GraphSourceEdit, value: unknown): boolean {
  if (!activeSdf || !codeEditor) return false;
  const nextSource = patchGraphEditSource(codeEditor.getValue(), activeSdf, edit, value);
  if (!nextSource) return false;
  const nextSourceLinks = findGraphSourceLinks(nextSource, activeSdf);
  const editedLink = sourceLinkForGraphEdit(nextSourceLinks, edit);
  codeEditor.setValue(nextSource);
  codeEditor.setError(null);
  updateSaveState();
  refreshSourceLinks(nextSource, activeSdf, nextSourceLinks);
  if (editedLink) {
    setSelectedSourceLink(editedLink);
  }
  codeEditor.markEditedSourceLink(editedLink, { reveal: editorView === "code" });
  return true;
}

function refreshSourceLinks(
  source = codeEditor?.getValue(),
  sdf = activeSdf,
  links = source && sdf ? findGraphSourceLinks(source, sdf) : [],
): void {
  if (!codeEditor || !source || !sdf) return;
  currentSourceLinks = links;
  codeEditor.setSourceLinks(links.filter((link) => link.nodeId !== sdf.node.id));
  graphInspector?.setSourceLinks(links);
  codeEditor.setFocusedNode(sourceFocusNodeId());
}

function setSelectedSourceLink(
  link: GraphSourceLink | null,
  options: { markCode?: boolean } = {},
): void {
  selectedSourceLink = link;
  graphInspector?.setSelectedSourceLink(link);
  if (options.markCode !== false) codeEditor?.markSelectedSourceLink(link);
  updateSelectionFocusButton();
  graphHistoryController.refresh();
}

function revealSelectedTarget(): void {
  const link = selectedSourceLink ?? (selectedNode ? sourceLinkForNodeId(selectedNode.id) : null);
  if (editorView === "graph") {
    if (link) revealGraphSource(link);
    else setEditorView("code");
    return;
  }
  if (link) {
    handleSourceLinkSelect(link, { revealGraph: true });
    return;
  }
  if (selectedNode) {
    setEditorView("graph");
    window.setTimeout(() => graphInspector?.revealSelected({ focus: true }), 0);
  }
}

function updateSelectionFocusButton(): void {
  const label = selectedSourceLink
    ? selectedSourceLinkLabel(selectedSourceLink)
    : selectedNode
      ? selectedNodeLabel(selectedNode)
      : "";

  if (!label) {
    selectionFocusButton.hidden = true;
    selectionFocusButton.textContent = "";
    selectionFocusButton.removeAttribute("title");
    selectionFocusButton.removeAttribute("aria-label");
    selectionFocusButton.removeAttribute("aria-keyshortcuts");
    return;
  }

  const destination = editorView === "graph" ? "code" : "graph";
  selectionFocusButton.hidden = false;
  selectionFocusButton.textContent = label;
  selectionFocusButton.title = `Reveal ${label} in ${destination} (Cmd/Ctrl+Alt+Enter)`;
  selectionFocusButton.setAttribute("aria-label", `Reveal ${label} in ${destination}`);
  selectionFocusButton.setAttribute("aria-keyshortcuts", SELECTED_TARGET_SHORTCUTS);
}

function selectedSourceLinkLabel(link: GraphSourceLink): string {
  return `${link.nodeKind} #${link.nodeId} ${link.label}`;
}

function selectedNodeLabel(node: Node): string {
  return `${node.kind} #${node.id}`;
}

function sourceFocusNodeId(): number | null {
  const node = hoveredNode ?? selectedNode;
  return node && !isActiveRootNode(node) ? node.id : null;
}

function sourceLinkForNodeId(nodeId: number): GraphSourceLink | null {
  return currentSourceLinks.find((link) => {
    return link.nodeId === nodeId && link.label === "call" && link.end > link.start;
  }) ?? currentSourceLinks.find((link) => {
    return link.nodeId === nodeId && link.end > link.start;
  }) ?? null;
}

function sourceLinkForGraphEdit(links: readonly GraphSourceLink[], edit: GraphSourceEdit): GraphSourceLink | null {
  return links.find((link) => {
    return link.nodeId === edit.nodeId && link.end > link.start && paramPathsEqual(link.path, edit.path);
  }) ?? links.find((link) => {
    return link.nodeId === edit.nodeId
      && link.end > link.start
      && link.scrubbable === false
      && paramPathStartsWith(edit.path, link.path);
  }) ?? links.find((link) => {
    return link.nodeId === edit.nodeId && link.end > link.start;
  }) ?? null;
}

function paramPathsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

function paramPathStartsWith(path: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

function sourceLinksEqual(a: GraphSourceLink | null, b: GraphSourceLink | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.nodeId === b.nodeId
    && a.nodeKind === b.nodeKind
    && a.label === b.label
    && a.start === b.start
    && a.end === b.end
    && paramPathsEqual(a.path, b.path);
}

function hoverGraphHistoryEntry(entry: GraphHistoryEntry, options: { shiftKey: boolean }): void {
  if (!graphInspector) return;
  const focus = options.shiftKey;
  const hoverKey = `${entry.id}:${focus}`;
  if (hoverKey === graphHistoryHoverKey) return;
  graphHistoryHoverKey = hoverKey;
  const before = previewHoverSignature();
  const node = graphInspector.setHoveredNodeById(entry.nodeId);
  const sourceLink = sourceLinkForGraphEdit(currentSourceLinks, entry);
  hoveredNode = node;
  graphInspector.setHoveredSourceLink(sourceLink);
  codeEditor?.markHoveredSourceLink(sourceLink);
  if (!node) {
    graphInspector.setFocusHoveredNodeById(null);
    focusPreview = null;
    schedulePreviewIfHoverChanged(before);
    return;
  }

  codeEditor?.setFocusedNode(node.id);
  if (focus && isHighlightableNode(node)) {
    graphInspector.setFocusHoveredNodeById(node.id);
    focusPreview = graphInspector.buildSoloPreviewForNodeId(node.id);
  } else {
    graphInspector.setFocusHoveredNodeById(null);
    focusPreview = null;
  }
  schedulePreviewIfHoverChanged(before);
}

function clearGraphHistoryEntryHover(): void {
  if (!graphInspector) return;
  graphHistoryHoverKey = null;
  const before = previewHoverSignature();
  hoveredNode = null;
  focusPreview = null;
  graphInspector.setHoveredNodeById(null);
  graphInspector.setFocusHoveredNodeById(null);
  graphInspector.setHoveredSourceLink(null);
  codeEditor?.markHoveredSourceLink(null);
  codeEditor?.setFocusedNode(selectedNode?.id ?? null);
  schedulePreviewIfHoverChanged(before);
}

function selectGraphHistoryEntry(entry: GraphHistoryEntry, options: { revealSource?: boolean } = {}): void {
  const node = graphInspector?.selectNodeById(entry.nodeId);
  if (!node) return;
  const sourceLink = sourceLinkForGraphEdit(currentSourceLinks, entry);
  if (sourceLink && options.revealSource) {
    revealGraphSource(sourceLink);
    schedulePreview(0);
    return;
  }
  setEditorView("graph");
  if (sourceLink) setSelectedSourceLink(sourceLink);
  setEditorStatus(`${entry.nodeKind} ${entry.label}`, "ok");
  afterBrowserFrame(() => graphInspector?.revealSelected({ focus: true }));
  schedulePreview(0);
}

function clearMesh(options: { keepView?: boolean; meshStatText?: string } = {}): void {
  window.clearTimeout(meshTimer);
  meshJob += 1;
  meshBuildPromise = null;
  mesh = null;
  lastBlob = null;
  downloadButton.disabled = true;
  meshViewButton.disabled = false;
  meshViewButton.removeAttribute("aria-busy");
  triangleStat.textContent = "-";
  meshStat.textContent = options.meshStatText ?? "-";
  if (viewMode === "mesh") {
    if (options.keepView) {
      overlay.textContent = `Regenerating mesh at ${gridLabel()}...`;
      shaderViewButton.setAttribute("aria-pressed", "false");
      meshViewButton.setAttribute("aria-pressed", "true");
      return;
    }
    setViewMode("shader");
  }
}

function activeRenderer(): { redraw(): void } | null {
  return viewMode === "shader" ? rayRenderer : meshRenderer;
}

function setPreviewLayout(layout: PreviewLayout, options: { recordChange?: boolean } = {}): void {
  previewLayout = layout;
  layoutViewButton.setAttribute("aria-pressed", String(layout === "quad"));
  layoutViewButton.title = layout === "quad" ? "Use single view" : "Use 2x2 view";
  layoutViewButton.setAttribute("aria-label", layoutViewButton.title);
  rayRenderer?.setLayout(layout);
  meshRenderer?.setLayout(layout);
  renderViewLabels();
  if (options.recordChange !== false) updateSaveState();
  activeRenderer()?.redraw();
}

function renderViewLabels(): void {
  viewLabels.replaceChildren();
  viewLabels.hidden = previewLayout !== "quad";
  if (previewLayout !== "quad") return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;

  for (const panel of viewPanels(previewLayout, width, height)) {
    const label = document.createElement("span");
    label.className = "view-label";
    label.textContent = panel.label;
    label.style.left = `${panel.x + 10}px`;
    label.style.top = `${height - panel.y - panel.height + 10}px`;
    viewLabels.append(label);
  }
}

function setEditorView(mode: EditorView): void {
  const previousMode = editorView;
  if (mode === "graph" && previousMode === "code" && !flushPendingSourceCompile()) {
    return;
  }

  editorView = mode;
  codeModeButton.setAttribute("aria-pressed", String(mode === "code"));
  graphModeButton.setAttribute("aria-pressed", String(mode === "graph"));
  codePanel.classList.toggle("hidden", mode !== "code");
  graphPanel.classList.toggle("hidden", mode !== "graph");
  updateSelectionFocusButton();
  if (editorView === "code") {
    afterBrowserFrame(() => {
      codeEditor?.layout();
      if (previousMode === "graph" && selectedSourceLink) {
        codeEditor?.revealSourceLink(selectedSourceLink);
      }
    });
  } else if (previousMode === "code") {
    codeEditor?.blur();
    afterBrowserFrame(() => {
      graphInspector?.revealSelected({ focus: true });
    });
  }
}

function setMeshAlgorithm(algorithm: MeshAlgorithm): void {
  setMeshAlgorithmMode(algorithm, { rebuild: true });
}

function setMeshAlgorithmMode(algorithm: MeshAlgorithm, options: { rebuild: boolean }): void {
  if (meshAlgorithm === algorithm) return;
  meshAlgorithm = algorithm;
  surfaceNetButton.setAttribute("aria-pressed", String(algorithm === "surface-net"));
  tetraMeshButton.setAttribute("aria-pressed", String(algorithm === "tetra"));
  updateSaveState();
  if (!options.rebuild) return;
  if (viewMode === "mesh") {
    clearMesh({ keepView: true, meshStatText: "queued" });
    scheduleMeshBuild();
  } else {
    clearMesh();
  }
}

function setViewMode(mode: RenderView): void {
  desiredViewMode = mode;
  if (mode === "mesh" && (!mesh || mesh.triangles.length === 0)) {
    shaderViewButton.setAttribute("aria-pressed", "false");
    meshViewButton.setAttribute("aria-pressed", "true");
    overlay.textContent = meshBuildPromise ? "Building mesh..." : "";
    return;
  }
  viewMode = mode;
  shaderViewButton.setAttribute("aria-pressed", String(mode === "shader"));
  meshViewButton.setAttribute("aria-pressed", String(mode === "mesh"));
  rayRenderer?.setActive(mode === "shader");
  meshRenderer?.setActive(mode === "mesh");
  if (mode === "mesh") updateMeshHighlight();
  overlay.textContent = "";
}

function schedulePreview(delay = 300): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void renderCurrent(), delay);
}

function scheduleMeshBuild(delay = 300): void {
  window.clearTimeout(meshTimer);
  meshTimer = window.setTimeout(() => void rebuildMeshView(), delay);
}

async function renderCurrent(): Promise<void> {
  if (!rayRenderer) return;
  const preview = soloPreview;
  const sdf = preview?.sdf ?? visibleActiveSdf();
  if (!sdf) {
    previewStat.textContent = "-";
    overlay.textContent = activeSdf ? "No visible graph nodes." : "Write editor code that returns an SDF3.";
    return;
  }

  const job = renderJob + 1;
  renderJob = job;
  const steps = Number(stepsInput.value);
  overlay.textContent = "Compiling shader preview...";
  stepsInput.disabled = true;
  const start = performance.now();
  try {
    if (job !== renderJob) return;
    const highlight = highlightForRender(preview);
    rayRenderer.render(sdf, currentBounds(), steps, highlight.node, highlight.mode);
    previewStat.textContent = `${(performance.now() - start).toFixed(1)} ms`;
    if (preview) {
      overlay.textContent = previewOverlayText("Solo", preview);
    } else if (focusPreview) {
      overlay.textContent = previewOverlayText("Focus", focusPreview);
    } else if (viewMode === "shader") {
      overlay.textContent = "";
    }
  } catch (error) {
    overlay.textContent = error instanceof Error ? error.message : String(error);
    previewStat.textContent = "failed";
  } finally {
    if (job === renderJob) stepsInput.disabled = false;
  }
}

function highlightForRender(preview: SoloPreview | null): { node: Node | null; mode: "mark" | "focus" } {
  if (preview?.node) return { node: isHighlightableNode(preview.node) ? preview.node : null, mode: "mark" };
  if (focusPreview?.sdf.node && isHighlightableNode(focusPreview.node)) {
    return { node: focusPreview.sdf.node, mode: "focus" };
  }
  if (hoveredNode && isHighlightableNode(hoveredNode)) return { node: hoveredNode, mode: "mark" };
  if (selectedNode && isHighlightableNode(selectedNode)) return { node: selectedNode, mode: "mark" };
  return { node: null, mode: "mark" };
}

function isActiveRootNode(node: Node): boolean {
  return activeSdf?.node.id === node.id;
}

function isHighlightableNode(node: Node): boolean {
  return !isActiveRootNode(node) && isNodeEffectivelyVisible(node.id);
}

function isNodeEffectivelyVisible(nodeId: number): boolean {
  if (!activeSdf) return false;
  let visible = false;

  const visit = (node: Node, inheritedHidden: boolean) => {
    if (visible) return;
    const hidden = inheritedHidden || hiddenNodeIds.has(node.id);
    if (node.id === nodeId && !hidden) {
      visible = true;
      return;
    }
    for (const child of node.children) visit(child.node, hidden);
  };

  visit(activeSdf.node, false);
  return visible;
}

async function showMesh(): Promise<void> {
  if (!mesh || mesh.triangles.length === 0) setViewMode("mesh");
  await buildMesh();
  if (desiredViewMode === "mesh" && mesh && mesh.triangles.length > 0) setViewMode("mesh");
}

async function rebuildMeshView(): Promise<void> {
  if (desiredViewMode !== "mesh") return;
  await buildMesh();
  if (desiredViewMode === "mesh" && viewMode === "mesh" && mesh && mesh.triangles.length > 0) {
    setViewMode("mesh");
  }
}

async function buildMesh(): Promise<void> {
  if (mesh && mesh.triangles.length > 0) return;
  if (meshBuildPromise) return meshBuildPromise;
  const sdf = visibleActiveSdf();
  if (!sdf) {
    overlay.textContent = activeSdf ? "No visible graph nodes to mesh." : "Fix the editor code before building mesh view.";
    return;
  }

  const job = meshJob + 1;
  meshJob = job;
  meshViewButton.disabled = true;
  meshViewButton.setAttribute("aria-busy", "true");
  downloadButton.disabled = true;
  meshStat.textContent = "building";
  overlay.textContent = `Sampling and polygonizing ${gridLabel()}...`;

  const buildPromise = (async () => {
    try {
      const result = await generateMesh(sdf, {
        grid: Number(gridInput.value),
        bounds: currentBounds(),
        preferGPU: true,
        algorithm: meshAlgorithm,
      });
      if (job !== meshJob) return;
      mesh = result;
      const highlight = highlightForRender(null);
      meshRenderer?.render(mesh.triangles, mesh.bounds, sdf, highlight.node, highlight.mode);
      lastBlob = binarySTL(mesh.triangles, `sdf-browser ${currentDocumentName()}`);
      const total = mesh.sampleTimeMs + mesh.polygonizeTimeMs;
      meshStat.textContent = `${total.toFixed(0)} ms ${mesh.usedGPU ? "GPU" : "CPU"}${mesh.usedWorker ? " worker" : ""} ${algorithmLabel(mesh.algorithm)}`;
      triangleStat.textContent = mesh.triangles.length.toLocaleString();
      downloadButton.disabled = mesh.triangles.length === 0;
      if (mesh.triangles.length === 0) {
        mesh = null;
        lastBlob = null;
        overlay.textContent = "Generated no triangles. Try wider bounds or a lower-level example.";
        return;
      }
      overlay.textContent = "";
    } catch (error) {
      if (job !== meshJob) return;
      overlay.textContent = error instanceof Error ? error.message : String(error);
      meshStat.textContent = "failed";
    } finally {
      if (job === meshJob) {
        meshViewButton.disabled = false;
        meshViewButton.removeAttribute("aria-busy");
      }
    }
  })();

  meshBuildPromise = buildPromise;
  try {
    await buildPromise;
  } finally {
    if (meshBuildPromise === buildPromise) meshBuildPromise = null;
  }
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

function restoreSourceDialogFocus(): void {
  if (sourceDialog.contains(document.activeElement)) {
    (document.activeElement as HTMLElement).blur();
  }
  loadSourceButton.focus({ preventScroll: true });
}

function readAppHealthDiagnosticsState(): AppHealthDiagnosticsState {
  return {
    ready: Boolean(codeEditor && graphInspector && activeSdf && rayRenderer && meshRenderer),
    editorReady: Boolean(codeEditor),
    graphReady: Boolean(graphInspector),
    activeSdfReady: Boolean(activeSdf),
    healthCheckMode,
    dirty: hasUnsavedChanges,
    status: editorStatus.textContent ?? "",
    sourceCompilePending: Boolean(sourceCompileTimer),
    sourceValid: editorSourceValid,
    viewMode,
    editorView,
    previewLayout,
    meshAlgorithm,
    sourceLinks: currentSourceLinks.length,
    selectedNode: selectedNode ? `${selectedNode.kind} #${selectedNode.id}` : null,
    selectedSourceLink: selectedSourceLink
      ? selectedSourceLinkLabel(selectedSourceLink)
      : null,
    sourceRevealedDecorations: codeEditor?.sourceDecorationCount("revealed") ?? 0,
    hiddenNodes: hiddenNodeIds.size,
    meshTriangles: mesh ? mesh.triangles.length : null,
    meshBuildPending: Boolean(meshBuildPromise),
  };
}

function currentBounds(): Bounds3 {
  return activeBounds;
}

function visibleActiveSdf(): SDF3 | null {
  return activeSdf ? buildVisibleSdf(activeSdf, hiddenNodeIds) : null;
}

function algorithmLabel(algorithm: MeshAlgorithm): string {
  return algorithm === "surface-net" ? "surface-net" : "tetra";
}

function gridLabel(): string {
  const grid = Number(gridInput.value);
  return `${grid}^3 (${(grid ** 3).toLocaleString()} samples)`;
}

function openSourceDialog(): void {
  const dialog = renderLoadDialog();
  if (sourceDialog.open) {
    dialog.focusSearch();
    return;
  }
  sourceDialog.showModal();
  afterBrowserFrame(() => dialog.focusSearch());
}

function renderLoadDialog(): ReturnType<typeof renderSourceDialog> {
  return renderSourceDialog(sourceDialogList, {
    examples,
    savedDocuments: listSavedSourceDocuments(),
    activeExampleId,
    activeDocumentId,
    activeVersionId: activeSourceVersionId,
  }, {
    loadExample,
    loadSaved: loadSavedSourceById,
    deleteDocument: deleteSavedDocument,
    deleteVersion: deleteSavedVersion,
  });
}

function currentDocumentName(): string {
  return documentNameInput.value.trim() || activeSourceName || "Untitled SDF";
}

function currentSourceValue(): string {
  return codeEditor?.getValue() ?? sourceForExample(activeExampleId);
}

function markSourceClean(source: string, name: string): void {
  cleanSourceSnapshot = source;
  cleanNameSnapshot = name;
  cleanPreviewSnapshot = previewProfileSnapshot(currentPreviewProfile());
  updateSaveState();
}

function detachDeletedSource(): void {
  activeDocumentId = null;
  activeSourceVersionId = null;
  activeSourceName = currentDocumentName();
  cleanSourceSnapshot = "";
  cleanNameSnapshot = "";
  updateSaveState();
}

function updateSaveState(): void {
  const nextDirty = currentSourceValue() !== cleanSourceSnapshot
    || currentDocumentName() !== cleanNameSnapshot
    || previewProfileSnapshot(currentPreviewProfile()) !== cleanPreviewSnapshot;
  hasUnsavedChanges = nextDirty;
  saveSourceButton.disabled = !nextDirty || !boundsAreValid;
  dirtyIndicator.hidden = !nextDirty;
  syncSourceDraft();
}

function syncSourceDraft(): void {
  if (!draftPersistenceEnabled) return;
  try {
    if (!hasUnsavedChanges) {
      clearSourceDraft();
      return;
    }
    saveSourceDraft({
      name: currentDocumentName(),
      source: currentSourceValue(),
      preview: currentPreviewProfile(),
      activeDocumentId,
      activeVersionId: activeSourceVersionId,
      activeExampleId,
    });
  } catch {
    // Draft persistence is a fallback; the visible save/error flow stays authoritative.
  }
}

function fitBoundsToCurrentSdf(): void {
  if (!activeSdf) {
    setEditorStatus("Fix code before fitting bounds", "error");
    return;
  }

  fitBoundsButton.disabled = true;
  boundsEditor?.setDisabled(true);
  overlay.textContent = "Fitting bounds...";
  try {
    activeBounds = paddedBounds(estimateBounds(activeSdf));
    boundsAreValid = true;
    boundsEditor?.setBounds(activeBounds);
    updateSaveState();
    setEditorStatus("Fit bounds", "ok");
    invalidateMeshForActiveSdf();
    schedulePreview(0);
  } catch (error) {
    setEditorStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    fitBoundsButton.disabled = false;
    boundsEditor?.setDisabled(false);
  }
}

function applyPreviewProfile(profile: PreviewProfile): void {
  activeBounds = cloneBounds(profile.bounds);
  boundsAreValid = true;
  pendingHiddenNodeKeys = profile.hiddenNodeKeys ?? [];
  boundsEditor?.setBounds(activeBounds);
  setRangeControl(stepsInput, stepsOutput, profile.raySteps);
  setRangeControl(gridInput, gridOutput, profile.meshGrid);
  setMeshAlgorithmMode(profile.meshAlgorithm, { rebuild: false });
  setPreviewLayout(profile.layout ?? "single", { recordChange: false });
}

function handleBoundsChange(bounds: Bounds3): void {
  activeBounds = cloneBounds(bounds);
  boundsAreValid = true;
  updateSaveState();
  setEditorStatus("Bounds updated", "ok");
  invalidateMeshForActiveSdf();
  schedulePreview(0);
}

function handleBoundsInvalid(message: string): void {
  boundsAreValid = false;
  updateSaveState();
  setEditorStatus(message, "error");
}

function currentPreviewProfile(): PreviewProfile {
  return createPreviewProfile({
    bounds: activeBounds,
    meshGrid: Number(gridInput.value),
    raySteps: Number(stepsInput.value),
    meshAlgorithm,
    layout: previewLayout,
    hiddenNodeKeys: hiddenNodeKeysForCurrentGraph(),
  });
}

function hiddenNodeKeysForCurrentGraph(): string[] {
  return hiddenNodeKeysForGraph(hiddenNodeIds, pendingHiddenNodeKeys, currentSourceLinks);
}

function setRangeControl(input: HTMLInputElement, output: HTMLOutputElement, value: number): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const clamped = Math.min(max, Math.max(min, value));
  input.value = String(clamped);
  output.value = input.value;
}

function confirmDiscardUnsavedChanges(): boolean {
  return !hasUnsavedChanges || window.confirm("Discard unsaved changes and load another shape?");
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "sdf";
}
