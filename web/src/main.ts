import type { Node, SDF3 } from "./core/nodes";
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
  type EditorViewSelectedTarget,
} from "./editor/editor-view-controller";
import { sourceForExample } from "./editor/example-source";
import { createGraphHistoryController, type GraphHistoryEntry } from "./editor/graph-history-controls";
import { GraphInspector, type GraphHoverOptions, type GraphParamEdit } from "./editor/graph-inspector";
import { sourceDiagnosticFromError } from "./editor/source-diagnostics";
import {
  createSourceEditorController,
  type EditorStatusState,
  type SourceCompileOptions,
} from "./editor/source-editor-controller";
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
  createPreviewProfile,
  hiddenNodeIdsFromKeys,
  hiddenNodeKeysForGraph,
  previewProfileSnapshot,
  type PreviewProfile,
} from "./editor/preview-profile";
import { createPreviewBoundsController } from "./editor/preview-bounds-controller";
import type { SoloPreview } from "./editor/solo-preview";
import {
  graphNodeLabel,
  sourceLinkForGraphEdit,
  sourceLinkForNodeId,
  sourceLinkLabel,
  sourceLinksEqual,
} from "./editor/source-link-matching";
import { createSourceWorkspaceActions } from "./editor/source-workspace-actions";
import { createSourceWorkspaceSession } from "./editor/source-workspace-session";
import { buildVisibleSdf } from "./editor/visible-sdf";
import { supportedSummary, unsupportedOriginalApi } from "./api/completeness";
import { currentExample, examples } from "./examples";
import { hasWebGPU } from "./gpu/webgpu";
import type { Bounds3 } from "./mesh/bounds";
import {
  createPreviewViewportController,
  type RenderHighlight,
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
let activeSdf: SDF3 | null = null;
let selectedNode: Node | null = null;
let hoveredNode: Node | null = null;
let focusPreview: SoloPreview | null = null;
let soloPreview: SoloPreview | null = null;
let hiddenNodeIds = new Set<number>();
let currentSourceLinks: readonly GraphSourceLink[] = [];
let selectedSourceLink: GraphSourceLink | null = null;
let pendingHiddenNodeKeys: readonly string[] = [];
let activeExampleId = examples[0]?.id ?? "canonical";
let graphHistoryHoverKey: string | null = null;
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
  preserveHiddenNodeKeys: () => {
    pendingHiddenNodeKeys = hiddenNodeKeysForCurrentGraph();
  },
  clearSourceLinks: () => {
    codeEditor?.setSourceLinks([]);
    graphInspector?.setSourceLinks([]);
  },
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
  readSelectedTarget: readSelectedEditorTarget,
  flushPendingSourceCompile: sourceEditorController.flushPendingCompile,
  afterBrowserFrame,
  revealGraphSource,
  revealSourceLinkInGraph: (link) => handleSourceLinkSelect(link, { revealGraph: true }),
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
  clearPendingHiddenNodeKeys: () => {
    pendingHiddenNodeKeys = [];
  },
  resetLoadedSourceState,
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
      onSelect: selectNode,
      onHover: handleGraphHover,
      onEdit: handleGraphEdit,
      onSolo: handleSoloPreview,
      onRevealSource: revealGraphSource,
      onSourceHover: handleGraphSourceHover,
      onVisibilityChange: handleGraphVisibilityChange,
    });
    compileEditorSource({ status: "Ready", statusState: "idle", invalidateMesh: false });
    await previewViewport.renderCurrent();
    const { createCodeEditor } = await import("./editor/code-editor");
    codeEditor = createCodeEditor(
      codeEditorElement,
      sourceForExample(activeExampleId),
      sourceEditorController.scheduleCompile,
      handleSourceLinkSelect,
      handleSourceLinkValueChange,
      handleSourceLinkHover,
      handleSourceLinkCursor,
      sourceEditorController.prettifyCurrentSource,
    );
    sourceEditorController.applyGraphHintsToEditor();
    if (healthCheckMode || !sourceWorkspaceActions.restoreDraft()) refreshSourceLinks();
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
    if (options.invalidateMesh !== false) previewViewport.invalidateMeshForActiveSdf();
    updateSaveState();
    previewViewport.schedulePreview(0);
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
  editorViewController.setView("graph");
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
  previewViewport.scheduleActivePreview(0);
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
  if (previewHoverSignature() !== before) previewViewport.scheduleActivePreview(0);
}

function previewOverlayText(prefix: "Focus" | "Solo", preview: SoloPreview): string {
  return `${prefix}: ${preview.label}${preview.preservedWrappers ? ` (${preview.preservedWrappers} context)` : ""}`;
}

function revealGraphSource(link: GraphSourceLink): void {
  editorViewController.setView("code");
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
  const sourceLink = node ? sourceLinkForNodeId(currentSourceLinks, node.id) : null;
  setSelectedSourceLink(sourceLink);
  codeEditor?.setFocusedNode(node?.id ?? null, { reveal: editorViewController.view === "code" });
  if (node && activeSdf) {
    setEditorStatus(`${node.kind} #${node.id}`, "ok");
    previewViewport.scheduleActivePreview(0);
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
    previewViewport.showSoloPreview();
    return;
  }

  previewViewport.clearSoloPreview();
}

function handleGraphVisibilityChange(hiddenIds: readonly number[]): void {
  hiddenNodeIds = new Set(hiddenIds);
  focusPreview = null;
  soloPreview = null;
  updateSaveState();
  previewViewport.invalidateMeshForActiveSdf();
  previewViewport.schedulePreview(0);
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!sourceWorkspace.hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "";
}

function applyGraphMutationStatus(message: string, edit?: GraphSourceEdit, value?: unknown): void {
  const synced = edit ? syncCodeFromGraphEdit(edit, value) : true;
  setEditorStatus(synced ? message : `${message} (preview only)`, synced ? "ok" : "pending");
  previewViewport.invalidateMeshForActiveSdf();
  previewViewport.schedulePreview(0);
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
  codeEditor.markEditedSourceLink(editedLink, { reveal: editorViewController.view === "code" });
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
  editorViewController.updateSelectionFocusButton();
  graphHistoryController.refresh();
}

function readSelectedEditorTarget(): EditorViewSelectedTarget {
  const link = selectedSourceLink ?? (selectedNode ? sourceLinkForNodeId(currentSourceLinks, selectedNode.id) : null);
  const label = selectedSourceLink
    ? sourceLinkLabel(selectedSourceLink)
    : selectedNode
      ? graphNodeLabel(selectedNode)
      : "";
  return { label, sourceLink: link, graphNode: selectedNode };
}

function sourceFocusNodeId(): number | null {
  const node = hoveredNode ?? selectedNode;
  return node && !isActiveRootNode(node) ? node.id : null;
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
    previewViewport.schedulePreview(0);
    return;
  }
  editorViewController.setView("graph");
  if (sourceLink) setSelectedSourceLink(sourceLink);
  setEditorStatus(`${entry.nodeKind} ${entry.label}`, "ok");
  afterBrowserFrame(() => graphInspector?.revealSelected({ focus: true }));
  previewViewport.schedulePreview(0);
}

function highlightForRender(preview: SoloPreview | null): RenderHighlight {
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
    sourceLinks: currentSourceLinks.length,
    selectedNode: selectedNode ? `${selectedNode.kind} #${selectedNode.id}` : null,
    selectedSourceLink: selectedSourceLink
      ? sourceLinkLabel(selectedSourceLink)
      : null,
    sourceRevealedDecorations: codeEditor?.sourceDecorationCount("revealed") ?? 0,
    hiddenNodes: hiddenNodeIds.size,
    meshTriangles: previewViewport.meshTriangles,
    meshBuildPending: previewViewport.meshBuildPending,
  };
}

function currentBounds(): Bounds3 {
  return previewBoundsController.bounds;
}

function visibleActiveSdf(): SDF3 | null {
  return activeSdf ? buildVisibleSdf(activeSdf, hiddenNodeIds) : null;
}

function readPreviewViewportState(): PreviewViewportState {
  const visibleSdf = visibleActiveSdf();
  return {
    activeSdf,
    visibleSdf,
    renderSdf: soloPreview?.sdf ?? visibleSdf,
    bounds: currentBounds(),
    documentName: currentDocumentName(),
    shaderHighlight: highlightForRender(soloPreview),
    meshHighlight: highlightForRender(null),
    soloOverlayText: soloPreview ? previewOverlayText("Solo", soloPreview) : "",
    focusOverlayText: focusPreview ? previewOverlayText("Focus", focusPreview) : "",
    hasSoloPreview: Boolean(soloPreview),
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

function resetLoadedSourceState(): void {
  selectedNode = null;
  selectedSourceLink = null;
  hoveredNode = null;
  focusPreview = null;
  hiddenNodeIds = new Set();
}

function applyPreviewProfile(profile: PreviewProfile): void {
  previewBoundsController.applyProfileBounds(profile.bounds);
  pendingHiddenNodeKeys = profile.hiddenNodeKeys ?? [];
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
    hiddenNodeKeys: hiddenNodeKeysForCurrentGraph(),
  });
}

function hiddenNodeKeysForCurrentGraph(): string[] {
  return hiddenNodeKeysForGraph(hiddenNodeIds, pendingHiddenNodeKeys, currentSourceLinks);
}
