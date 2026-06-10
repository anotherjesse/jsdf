import type { Node, SDF3 } from "./core/nodes";
import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceEdit, type GraphSourceLink } from "./editor/clean-source-patch";
import type { CodeEditor, SourceLinkHoverOptions } from "./editor/code-editor";
import { evaluateSource } from "./editor/evaluate-source";
import { sourceForExample } from "./editor/example-source";
import { GraphEditHistory, formatGraphValue, type GraphHistoryEntry } from "./editor/graph-history";
import { GraphInspector, type GraphHoverOptions, type GraphParamEdit } from "./editor/graph-inspector";
import type { SoloPreview } from "./editor/solo-preview";
import { renderSourceDialog } from "./editor/source-dialog";
import {
  deleteSavedSourceDocument,
  deleteSavedSourceVersion,
  latestSourceVersion,
  listSavedSourceDocuments,
  loadSavedSourceVersion,
  saveSourceVersion,
  type SavedSourceDocument,
} from "./editor/workspace-storage";
import { currentExample, examples, supportedSummary, unsupportedPythonApi } from "./examples";
import { hasWebGPU } from "./gpu/webgpu";
import { type Bounds3 } from "./mesh/bounds";
import { binarySTL, downloadBlob, generateMesh, type MeshAlgorithm, type MeshResult } from "./mesh/generate";
import { OrbitCamera } from "./preview/orbit-camera";
import { WebGLMeshRenderer } from "./preview/webgl-mesh-renderer";
import { WebGLRaymarchRenderer } from "./preview/webgl-raymarch-renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const documentNameInput = document.querySelector<HTMLInputElement>("#documentNameInput")!;
const dirtyIndicator = document.querySelector<HTMLElement>("#dirtyIndicator")!;
const loadSourceButton = document.querySelector<HTMLButtonElement>("#loadSourceButton")!;
const saveSourceButton = document.querySelector<HTMLButtonElement>("#saveSourceButton")!;
const sourceDialog = document.querySelector<HTMLDialogElement>("#sourceDialog")!;
const sourceDialogList = document.querySelector<HTMLElement>("#sourceDialogList")!;
const closeSourceDialogButton = document.querySelector<HTMLButtonElement>("#closeSourceDialogButton")!;
const gpuBadge = document.querySelector<HTMLElement>("#gpuBadge")!;
const shaderViewButton = document.querySelector<HTMLButtonElement>("#shaderViewButton")!;
const meshViewButton = document.querySelector<HTMLButtonElement>("#meshViewButton")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#downloadButton")!;
const surfaceNetButton = document.querySelector<HTMLButtonElement>("#surfaceNetButton")!;
const tetraMeshButton = document.querySelector<HTMLButtonElement>("#tetraMeshButton")!;
const codeModeButton = document.querySelector<HTMLButtonElement>("#codeModeButton")!;
const graphModeButton = document.querySelector<HTMLButtonElement>("#graphModeButton")!;
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
const previewStat = document.querySelector<HTMLElement>("#previewStat")!;
const meshStat = document.querySelector<HTMLElement>("#meshStat")!;
const triangleStat = document.querySelector<HTMLElement>("#triangleStat")!;
const apiStat = document.querySelector<HTMLElement>("#apiStat")!;
const overlay = document.querySelector<HTMLElement>("#overlay")!;

type RenderView = "shader" | "mesh";
type EditorView = "code" | "graph";
type EditorStatusState = "idle" | "ok" | "pending" | "error";

let rayRenderer: WebGLRaymarchRenderer | null = null;
let meshRenderer: WebGLMeshRenderer | null = null;
let codeEditor: CodeEditor | null = null;
let graphInspector: GraphInspector | null = null;
let activeSdf: SDF3 | null = null;
let selectedNode: Node | null = null;
let hoveredNode: Node | null = null;
let soloPreview: SoloPreview | null = null;
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
let meshAlgorithm: MeshAlgorithm = "surface-net";
let editorView: EditorView = "code";
let activeExampleId = examples[0]?.id ?? "canonical";
let activeDocumentId: string | null = null;
let activeSourceVersionId: string | null = null;
let activeSourceName = currentExample(activeExampleId).name;
let cleanSourceSnapshot = sourceForExample(activeExampleId);
let cleanNameSnapshot = activeSourceName;
let hasUnsavedChanges = false;
const graphHistory = new GraphEditHistory();

apiStat.textContent = `${Object.values(supportedSummary).reduce((a, b) => a + b, 0)} supported; excludes ${unsupportedPythonApi.length}`;
stepsOutput.value = stepsInput.value;
gridOutput.value = gridInput.value;
documentNameInput.value = activeSourceName;
updateSaveState();
renderLoadDialog();

stepsInput.addEventListener("input", () => {
  stepsOutput.value = stepsInput.value;
  schedulePreview();
});
gridInput.addEventListener("input", () => {
  gridOutput.value = gridInput.value;
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
surfaceNetButton.addEventListener("click", () => setMeshAlgorithm("surface-net"));
tetraMeshButton.addEventListener("click", () => setMeshAlgorithm("tetra"));
downloadButton.addEventListener("click", () => {
  if (lastBlob) downloadBlob(lastBlob, `${slugify(currentDocumentName())}.stl`);
});
documentNameInput.addEventListener("input", updateSaveState);
loadSourceButton.addEventListener("click", openSourceDialog);
saveSourceButton.addEventListener("click", saveCurrentSource);
closeSourceDialogButton.addEventListener("click", () => sourceDialog.close());
sourceDialog.addEventListener("click", (event) => {
  if (event.target === sourceDialog) sourceDialog.close();
});
codeModeButton.addEventListener("click", () => setEditorView("code"));
graphModeButton.addEventListener("click", () => setEditorView("graph"));
undoGraphButton.addEventListener("click", undoGraphEdit);
redoGraphButton.addEventListener("click", redoGraphEdit);
resetGraphButton.addEventListener("click", resetGraphEdits);
window.addEventListener("resize", () => activeRenderer()?.redraw());

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
    graphInspector = new GraphInspector(graphInspectorElement, {
      onSelect: selectNode,
      onHover: handleGraphHover,
      onEdit: handleGraphEdit,
      onSolo: handleSoloPreview,
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
    );
    refreshSourceLinks();
  } catch (error) {
    gpuBadge.textContent = "Preview error";
    gpuBadge.classList.add("warn");
    overlay.textContent = error instanceof Error ? error.message : String(error);
  }
}

function loadExample(id: string): void {
  if (!confirmDiscardUnsavedChanges()) return;
  window.clearTimeout(sourceCompileTimer);
  activeExampleId = id;
  activeDocumentId = null;
  activeSourceVersionId = null;
  activeSourceName = currentExample(id).name;
  const source = sourceForExample(id);
  documentNameInput.value = activeSourceName;
  selectedNode = null;
  hoveredNode = null;
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
  loadSavedSource(loaded.document, loaded.version.id, loaded.version.source);
}

function loadSavedSource(document: SavedSourceDocument, versionId: string, source: string): void {
  window.clearTimeout(sourceCompileTimer);
  activeDocumentId = document.id;
  activeSourceVersionId = versionId;
  activeSourceName = document.name;
  documentNameInput.value = document.name;
  selectedNode = null;
  hoveredNode = null;
  codeEditor?.setValue(source);
  markSourceClean(source, document.name);
  renderLoadDialog();
  sourceDialog.close();
  compileEditorSource({ status: "Ready", statusState: "idle" });
}

function saveCurrentSource(): void {
  const source = codeEditor?.getValue() ?? sourceForExample(activeExampleId);
  try {
    const saved = saveSourceVersion(currentDocumentName(), source, activeDocumentId);
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
  window.clearTimeout(sourceCompileTimer);
  updateSaveState();
  setEditorStatus("Editing...", "pending");
  codeEditor?.setSourceLinks([]);
  sourceCompileTimer = window.setTimeout(() => {
    compileEditorSource({ status: "Compiled" });
  }, 350);
}

function compileEditorSource(
  options: { status: string; statusState?: EditorStatusState; invalidateMesh?: boolean } = { status: "Compiled" },
): boolean {
  const source = codeEditor?.getValue() ?? sourceForExample(activeExampleId);
  try {
    const { sdf } = evaluateSource(source);
    soloPreview = null;
    activeSdf = sdf;
    graphInspector?.setSdf(sdf);
    codeEditor?.setError(null);
    refreshSourceLinks(source, sdf);
    clearGraphHistory();
    setEditorStatus(options.status, options.statusState ?? "ok");
    if (options.invalidateMesh !== false) invalidateMeshForActiveSdf();
    schedulePreview(0);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    codeEditor?.setError(message);
    codeEditor?.setSourceLinks([]);
    setEditorStatus(message, "error");
    overlay.textContent = `Code error: ${message}`;
    return false;
  }
}

function handleSourceLinkSelect(link: GraphSourceLink): void {
  const node = graphInspector?.selectNodeById(link.nodeId);
  if (!node) return;
  setEditorStatus(`${link.nodeKind} ${link.label}`, "ok");
  schedulePreview(0);
}

function handleSourceLinkValueChange(link: GraphSourceLink, nextValue: number): void {
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
  });
}

function handleSourceLinkHover(link: GraphSourceLink | null, options: SourceLinkHoverOptions): void {
  if (!graphInspector) return;
  if (!link) {
    hoveredNode = null;
    graphInspector.setHoveredNodeById(null);
    if (soloPreview) handleSoloPreview(null);
    else schedulePreview(0);
    const selected = graphInspector.getSelected();
    codeEditor?.setFocusedNode(selected?.id ?? null);
    if (selected) setEditorStatus(`${selected.kind} #${selected.id}`, "ok");
    return;
  }

  const node = graphInspector.setHoveredNodeById(link.nodeId);
  hoveredNode = node;
  if (!node) return;
  codeEditor?.setFocusedNode(node.id);

  if (options.shiftKey) {
    handleSoloPreview(graphInspector.buildSoloPreviewForNodeId(link.nodeId));
    setEditorStatus(`Solo ${node.kind} #${node.id}`, "ok");
    return;
  }

  if (soloPreview) handleSoloPreview(null);
  else schedulePreview(0);
  setEditorStatus(`${link.nodeKind} ${link.label}`, "ok");
}

function handleGraphHover(node: Node | null, options: GraphHoverOptions): void {
  if (!graphInspector) return;
  hoveredNode = node;
  if (!node) {
    if (soloPreview) handleSoloPreview(null);
    else schedulePreview(0);
    codeEditor?.setFocusedNode(selectedNode?.id ?? null);
    if (selectedNode) setEditorStatus(`${selectedNode.kind} #${selectedNode.id}`, "ok");
    return;
  }

  codeEditor?.setFocusedNode(node.id);
  if (options.shiftKey) {
    handleSoloPreview(graphInspector.buildSoloPreviewForNodeId(node.id));
    setEditorStatus(`Solo ${node.kind} #${node.id}`, "ok");
    return;
  }

  if (soloPreview) handleSoloPreview(null);
  else schedulePreview(0);
  setEditorStatus(`${node.kind} #${node.id}`, "ok");
}

function selectNode(node: Node | null): void {
  selectedNode = node;
  codeEditor?.setFocusedNode(node?.id ?? null, { reveal: editorView === "code" });
  if (node && activeSdf) {
    setEditorStatus(`${node.kind} #${node.id}`, "ok");
    schedulePreview(0);
  }
}

function handleGraphEdit(edit: GraphParamEdit): void {
  if (!activeSdf) return;
  soloPreview = null;
  recordGraphEdit(edit);
  applyGraphMutationStatus(`Edited ${edit.nodeKind} ${edit.label}`, edit, edit.nextValue);
}

function handleSoloPreview(preview: SoloPreview | null): void {
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

function invalidateMeshForActiveSdf(): void {
  if (desiredViewMode === "mesh" || viewMode === "mesh") {
    clearMesh({ keepView: viewMode === "mesh", meshStatText: "queued" });
    scheduleMeshBuild();
    return;
  }
  clearMesh();
}

function recordGraphEdit(edit: GraphParamEdit): void {
  graphHistory.record(edit);
  updateGraphHistoryControls();
}

function undoGraphEdit(): void {
  const entry = graphHistory.undo((candidate) => {
    return Boolean(graphInspector?.setParamValue(candidate.nodeId, candidate.path, candidate.previousValue));
  });
  updateGraphHistoryControls();
  if (!entry) return;
  applyGraphMutationStatus(`Undid ${entry.nodeKind} ${entry.label}`, entry, entry.previousValue);
}

function redoGraphEdit(): void {
  const entry = graphHistory.redo((candidate) => {
    return Boolean(graphInspector?.setParamValue(candidate.nodeId, candidate.path, candidate.nextValue));
  });
  updateGraphHistoryControls();
  if (!entry) return;
  applyGraphMutationStatus(`Redid ${entry.nodeKind} ${entry.label}`, entry, entry.nextValue);
}

function resetGraphEdits(): void {
  if (!graphHistory.canUndo) return;
  let didReset = false;
  while (graphHistory.canUndo) {
    const entry = graphHistory.undo((candidate) => {
      return Boolean(graphInspector?.setParamValue(candidate.nodeId, candidate.path, candidate.previousValue));
    });
    if (!entry) break;
    syncCodeFromGraphEdit(entry, entry.previousValue);
    didReset = true;
  }
  graphHistory.clear();
  updateGraphHistoryControls();
  if (didReset) {
    applyGraphMutationStatus("Reset graph");
  }
}

function applyGraphMutationStatus(message: string, edit?: GraphSourceEdit, value?: unknown): void {
  if (edit) syncCodeFromGraphEdit(edit, value);
  setEditorStatus(message, "ok");
  invalidateMeshForActiveSdf();
  schedulePreview(0);
}

function syncCodeFromGraphEdit(edit: GraphSourceEdit, value: unknown): void {
  if (!activeSdf || !codeEditor) return;
  const nextSource = patchGraphEditSource(codeEditor.getValue(), activeSdf, edit, value);
  if (!nextSource) return;
  codeEditor.setValue(nextSource);
  codeEditor.setError(null);
  updateSaveState();
  refreshSourceLinks(nextSource, activeSdf);
}

function refreshSourceLinks(source = codeEditor?.getValue(), sdf = activeSdf): void {
  if (!codeEditor || !source || !sdf) return;
  codeEditor.setSourceLinks(findGraphSourceLinks(source, sdf));
  codeEditor.setFocusedNode(hoveredNode?.id ?? selectedNode?.id ?? null);
}

function clearGraphHistory(): void {
  graphHistory.clear();
  updateGraphHistoryControls();
}

function updateGraphHistoryControls(): void {
  undoGraphButton.disabled = !graphHistory.canUndo;
  redoGraphButton.disabled = !graphHistory.canRedo;
  resetGraphButton.disabled = !graphHistory.canUndo;
  renderGraphChangeJournal();
}

function renderGraphChangeJournal(): void {
  const entries = graphHistory.current();
  graphChangeJournal.replaceChildren();
  graphChangeJournal.hidden = entries.length === 0;
  if (entries.length === 0) return;

  const count = document.createElement("span");
  count.className = "change-journal-count";
  count.textContent = `${entries.length} ${entries.length === 1 ? "change" : "changes"}`;

  const list = document.createElement("div");
  list.className = "change-journal-list";
  const visibleEntries = entries.slice(-3).reverse();
  for (const entry of visibleEntries) {
    list.append(renderGraphChangeEntry(entry));
  }
  if (entries.length > visibleEntries.length) {
    const overflow = document.createElement("span");
    overflow.className = "change-journal-more";
    overflow.textContent = `+${entries.length - visibleEntries.length}`;
    list.append(overflow);
  }

  graphChangeJournal.append(count, list);
}

function renderGraphChangeEntry(entry: GraphHistoryEntry): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "change-entry";
  button.title = `Select ${entry.nodeKind} #${entry.nodeId}: ${entry.label} ${formatGraphValue(entry.previousValue)} -> ${formatGraphValue(entry.nextValue)}`;
  button.setAttribute("aria-label", button.title);
  button.dataset.nodeId = String(entry.nodeId);

  const node = document.createElement("span");
  node.className = "change-entry-node";
  node.textContent = `${entry.nodeKind} #${entry.nodeId}`;

  const value = document.createElement("span");
  value.className = "change-entry-value";
  value.textContent = `${entry.label} ${formatGraphValue(entry.nextValue)}`;

  button.append(node, value);
  button.addEventListener("click", () => selectGraphHistoryEntry(entry));
  return button;
}

function selectGraphHistoryEntry(entry: GraphHistoryEntry): void {
  const node = graphInspector?.selectNodeById(entry.nodeId);
  if (!node) return;
  setEditorView("graph");
  setEditorStatus(`${entry.nodeKind} ${entry.label}`, "ok");
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

function setEditorView(mode: EditorView): void {
  editorView = mode;
  codeModeButton.setAttribute("aria-pressed", String(mode === "code"));
  graphModeButton.setAttribute("aria-pressed", String(mode === "graph"));
  codePanel.classList.toggle("hidden", mode !== "code");
  graphPanel.classList.toggle("hidden", mode !== "graph");
  if (editorView === "code") {
    window.requestAnimationFrame(() => codeEditor?.layout());
  }
}

function setMeshAlgorithm(algorithm: MeshAlgorithm): void {
  if (meshAlgorithm === algorithm) return;
  meshAlgorithm = algorithm;
  surfaceNetButton.setAttribute("aria-pressed", String(algorithm === "surface-net"));
  tetraMeshButton.setAttribute("aria-pressed", String(algorithm === "tetra"));
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
  const sdf = preview?.sdf ?? activeSdf;
  if (!sdf) {
    previewStat.textContent = "-";
    overlay.textContent = "Write editor code that returns an SDF3.";
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
    rayRenderer.render(sdf, currentBounds(), steps, preview?.node ?? hoveredNode ?? selectedNode);
    previewStat.textContent = `${(performance.now() - start).toFixed(1)} ms`;
    if (preview) {
      overlay.textContent = `Solo: ${preview.label}${preview.preservedWrappers ? ` (${preview.preservedWrappers} context)` : ""}`;
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
  const sdf = activeSdf;
  if (!sdf) {
    overlay.textContent = "Fix the editor code before building mesh view.";
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
      meshRenderer?.render(mesh.triangles, mesh.bounds);
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

function currentBounds(): Bounds3 {
  return (currentExample(activeExampleId).bounds ?? [[-4, -4, -4], [4, 4, 4]]) as Bounds3;
}

function algorithmLabel(algorithm: MeshAlgorithm): string {
  return algorithm === "surface-net" ? "surface-net" : "tetra";
}

function gridLabel(): string {
  const grid = Number(gridInput.value);
  return `${grid}^3 (${(grid ** 3).toLocaleString()} samples)`;
}

function openSourceDialog(): void {
  renderLoadDialog();
  if (sourceDialog.open) return;
  sourceDialog.showModal();
}

function renderLoadDialog(): void {
  renderSourceDialog(sourceDialogList, {
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
  const nextDirty = currentSourceValue() !== cleanSourceSnapshot || currentDocumentName() !== cleanNameSnapshot;
  hasUnsavedChanges = nextDirty;
  saveSourceButton.disabled = !nextDirty;
  dirtyIndicator.hidden = !nextDirty;
}

function confirmDiscardUnsavedChanges(): boolean {
  return !hasUnsavedChanges || window.confirm("Discard unsaved changes and load another shape?");
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "sdf";
}
