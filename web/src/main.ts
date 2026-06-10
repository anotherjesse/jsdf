import { currentExample, examples, supportedSummary, unsupportedPythonApi } from "./examples";
import { hasWebGPU } from "./gpu/webgpu";
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
const stepsInput = document.querySelector<HTMLInputElement>("#stepsInput")!;
const stepsOutput = document.querySelector<HTMLOutputElement>("#stepsOutput")!;
const gridInput = document.querySelector<HTMLInputElement>("#gridInput")!;
const gridOutput = document.querySelector<HTMLOutputElement>("#gridOutput")!;
const previewStat = document.querySelector<HTMLElement>("#previewStat")!;
const meshStat = document.querySelector<HTMLElement>("#meshStat")!;
const triangleStat = document.querySelector<HTMLElement>("#triangleStat")!;
const apiStat = document.querySelector<HTMLElement>("#apiStat")!;
const overlay = document.querySelector<HTMLElement>("#overlay")!;

let rayRenderer: WebGLRaymarchRenderer | null = null;
let meshRenderer: WebGLMeshRenderer | null = null;
let mesh: MeshResult | null = null;
let meshBuildPromise: Promise<void> | null = null;
let lastBlob: Blob | null = null;
let renderJob = 0;
let meshJob = 0;
let previewTimer = 0;
let meshTimer = 0;
let viewMode: "shader" | "mesh" = "shader";
let desiredViewMode: "shader" | "mesh" = "shader";
let meshAlgorithm: MeshAlgorithm = "surface-net";

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
exampleSelect.addEventListener("change", () => {
  clearMesh();
  schedulePreview(0);
});
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
    setViewMode("shader");
    await renderCurrent();
  } catch (error) {
    gpuBadge.textContent = "Preview error";
    gpuBadge.classList.add("warn");
    overlay.textContent = error instanceof Error ? error.message : String(error);
  }
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

function setViewMode(mode: "shader" | "mesh"): void {
  desiredViewMode = mode;
  if (mode === "mesh" && (!mesh || mesh.triangles.length === 0)) {
    shaderViewButton.setAttribute("aria-pressed", "false");
    meshViewButton.setAttribute("aria-pressed", "true");
    overlay.textContent = meshBuildPromise
      ? "Sampling and polygonizing the SDF volume..."
      : "Mesh view builds the STL surface on demand.";
    return;
  }
  viewMode = mode;
  shaderViewButton.setAttribute("aria-pressed", String(mode === "shader"));
  meshViewButton.setAttribute("aria-pressed", String(mode === "mesh"));
  rayRenderer?.setActive(mode === "shader");
  meshRenderer?.setActive(mode === "mesh");
  overlay.textContent = mode === "shader"
    ? `Shader preview: direct SDF raymarching with ${stepsInput.value} steps.`
    : `Mesh preview: ${mesh?.triangles.length.toLocaleString() ?? 0} ${algorithmLabel(mesh?.algorithm ?? meshAlgorithm)} triangles from ${gridLabel()}.`;
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
  const job = renderJob + 1;
  renderJob = job;
  const example = currentExample(exampleSelect.value);
  const sdf = example.build();
  const steps = Number(stepsInput.value);
  overlay.textContent = `Compiling shader preview...`;
  stepsInput.disabled = true;
  const start = performance.now();
  try {
    if (job !== renderJob) return;
    rayRenderer.render(sdf, example.bounds ?? [[-4, -4, -4], [4, 4, 4]], steps);
    previewStat.textContent = `${(performance.now() - start).toFixed(1)} ms`;
    if (viewMode === "shader") {
      overlay.textContent = `Shader preview: direct SDF raymarching with ${steps} steps.`;
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

  const example = currentExample(exampleSelect.value);
  const sdf = example.build();
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
        bounds: example.bounds,
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
      overlay.textContent = `Generated ${mesh.triangles.length.toLocaleString()} ${algorithmLabel(mesh.algorithm)} triangles from ${gridLabel()}.`;
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

function algorithmLabel(algorithm: MeshAlgorithm): string {
  return algorithm === "surface-net" ? "surface-net" : "tetra";
}

function gridLabel(): string {
  const grid = Number(gridInput.value);
  return `${grid}^3 (${(grid ** 3).toLocaleString()} samples)`;
}
