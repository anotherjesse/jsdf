import type { Node, SDF3 } from "./core/nodes";
import { findGraphSourceLinks, patchGraphEditSource, type GraphSourceEdit, type GraphSourceLink } from "./editor/clean-source-patch";
import type { CodeEditor } from "./editor/code-editor";
import { evaluateSource } from "./editor/evaluate-source";
import { sourceForExample } from "./editor/example-source";
import { GraphEditHistory, formatGraphValue, type GraphHistoryEntry } from "./editor/graph-history";
import { GraphInspector, type GraphParamEdit } from "./editor/graph-inspector";
import type { SoloPreview } from "./editor/solo-preview";
import { currentExample, examples, supportedSummary, unsupportedPythonApi } from "./examples";
import { hasWebGPU } from "./gpu/webgpu";
import { type Bounds3 } from "./mesh/bounds";
import { binarySTL, downloadBlob, generateMesh, type MeshAlgorithm, type MeshResult } from "./mesh/generate";
import { OrbitCamera } from "./preview/orbit-camera";
import { WebGLMeshRenderer } from "./preview/webgl-mesh-renderer";
import { WebGLRaymarchRenderer } from "./preview/webgl-raymarch-renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const exampleSelect = document.querySelector<HTMLSelectElement>("#exampleSelect")!;
const gpuBadge = document.querySelector<HTMLSpanElement>("#gpuBadge")!;
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

let rayRenderer: WebGLRaymarchRenderer | null = null;
let meshRenderer: WebGLMeshRenderer | null = null;
let codeEditor: CodeEditor | null = null;
let graphInspector: GraphInspector | null = null;
let activeSdf: SDF3 | null = null;
let selectedNode: Node | null = null;
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
const graphHistory = new GraphEditHistory();

for (const example of examples) {
  const option = document.createElement("option");
  option.value = example.id;
  option.textContent = example.name;
  exampleSelect.append(option);
}

apiStat.textContent = `${Object.values(supportedSummary).reduce((a, b) => a + b, 0)} supported; excludes ${unsupportedPythonApi.length}`;
stepsOutput.value = stepsInput.value;
gridOutput.value = gridInput.value;

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
  if (lastBlob) downloadBlob(lastBlob, `${exampleSelect.value}.stl`);
});
exampleSelect.addEventListener("change", () => loadExample(exampleSelect.value));
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
      onEdit: handleGraphEdit,
      onSolo: handleSoloPreview,
    });
    setViewMode("shader");
    compileEditorSource({ status: "Loaded example", invalidateMesh: false });
    await renderCurrent();
    const { createCodeEditor } = await import("./editor/code-editor");
    codeEditor = createCodeEditor(
      codeEditorElement,
      sourceForExample(exampleSelect.value),
      scheduleSourceCompile,
      handleSourceLinkSelect,
      handleSourceLinkValueChange,
    );
    refreshSourceLinks();
  } catch (error) {
    gpuBadge.textContent = "Preview error";
    gpuBadge.classList.add("warn");
    overlay.textContent = error instanceof Error ? error.message : String(error);
  }
}

function loadExample(id: string): void {
  window.clearTimeout(sourceCompileTimer);
  selectedNode = null;
  codeEditor?.setValue(sourceForExample(id));
  compileEditorSource({ status: "Loaded example" });
}

function scheduleSourceCompile(): void {
  window.clearTimeout(sourceCompileTimer);
  setEditorStatus("Editing...", "pending");
  codeEditor?.setSourceLinks([]);
  sourceCompileTimer = window.setTimeout(() => {
    compileEditorSource({ status: "Compiled" });
  }, 350);
}

function compileEditorSource(options: { status: string; invalidateMesh?: boolean } = { status: "Compiled" }): boolean {
  const source = codeEditor?.getValue() ?? sourceForExample(exampleSelect.value);
  try {
    const { sdf } = evaluateSource(source);
    soloPreview = null;
    activeSdf = sdf;
    graphInspector?.setSdf(sdf);
    codeEditor?.setError(null);
    refreshSourceLinks(source, sdf);
    clearGraphHistory();
    setEditorStatus(options.status, "ok");
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

function selectNode(node: Node | null): void {
  selectedNode = node;
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
  refreshSourceLinks(nextSource, activeSdf);
}

function refreshSourceLinks(source = codeEditor?.getValue(), sdf = activeSdf): void {
  if (!codeEditor || !source || !sdf) return;
  codeEditor.setSourceLinks(findGraphSourceLinks(source, sdf));
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
    rayRenderer.render(sdf, currentBounds(), steps, preview?.node ?? selectedNode);
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

  const example = currentExample(exampleSelect.value);
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
      lastBlob = binarySTL(mesh.triangles, `sdf-browser ${example.name}`);
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

function setEditorStatus(message: string, state: "ok" | "pending" | "error"): void {
  editorStatus.textContent = message;
  editorStatus.dataset.state = state;
  editorStatus.title = message;
}

function currentBounds(): Bounds3 {
  return (currentExample(exampleSelect.value).bounds ?? [[-4, -4, -4], [4, 4, 4]]) as Bounds3;
}

function algorithmLabel(algorithm: MeshAlgorithm): string {
  return algorithm === "surface-net" ? "surface-net" : "tetra";
}

function gridLabel(): string {
  const grid = Number(gridInput.value);
  return `${grid}^3 (${(grid ** 3).toLocaleString()} samples)`;
}
