import { currentExample, examples, supportedSummary, unsupportedPythonApi } from "./examples";
import { hasWebGPU } from "./gpu/webgpu";
import { binarySTL, downloadBlob, generateMesh, type MeshResult } from "./mesh/generate";
import { WebGLMeshRenderer } from "./preview/webgl-mesh-renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const exampleSelect = document.querySelector<HTMLSelectElement>("#exampleSelect")!;
const gpuBadge = document.querySelector<HTMLSpanElement>("#gpuBadge")!;
const meshButton = document.querySelector<HTMLButtonElement>("#meshButton")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#downloadButton")!;
const stepsInput = document.querySelector<HTMLInputElement>("#stepsInput")!;
const stepsOutput = document.querySelector<HTMLOutputElement>("#stepsOutput")!;
const gridInput = document.querySelector<HTMLInputElement>("#gridInput")!;
const gridOutput = document.querySelector<HTMLOutputElement>("#gridOutput")!;
const previewStat = document.querySelector<HTMLElement>("#previewStat")!;
const meshStat = document.querySelector<HTMLElement>("#meshStat")!;
const triangleStat = document.querySelector<HTMLElement>("#triangleStat")!;
const apiStat = document.querySelector<HTMLElement>("#apiStat")!;
const overlay = document.querySelector<HTMLElement>("#overlay")!;

let renderer: WebGLMeshRenderer | null = null;
let mesh: MeshResult | null = null;
let lastBlob: Blob | null = null;
let renderJob = 0;
let previewTimer = 0;

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
  mesh = null;
  lastBlob = null;
  downloadButton.disabled = true;
  triangleStat.textContent = "-";
  meshStat.textContent = "-";
});
meshButton.addEventListener("click", () => void meshCurrent());
downloadButton.addEventListener("click", () => {
  if (lastBlob) downloadBlob(lastBlob, `${exampleSelect.value}.stl`);
});
exampleSelect.addEventListener("change", () => {
  mesh = null;
  lastBlob = null;
  downloadButton.disabled = true;
  triangleStat.textContent = "-";
  meshStat.textContent = "-";
  schedulePreview(0);
});
window.addEventListener("resize", () => renderer?.redraw());

void boot();

async function boot(): Promise<void> {
  if (!hasWebGPU()) {
    gpuBadge.textContent = "WebGL CPU";
    gpuBadge.classList.add("warn");
  } else {
    gpuBadge.textContent = "WebGPU + WebGL";
    gpuBadge.classList.add("ok");
  }

  try {
    renderer = new WebGLMeshRenderer(canvas);
    await renderCurrent();
  } catch (error) {
    gpuBadge.textContent = "Preview error";
    gpuBadge.classList.add("warn");
    overlay.textContent = error instanceof Error ? error.message : String(error);
  }
}

function schedulePreview(delay = 300): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void renderCurrent(), delay);
}

async function renderCurrent(): Promise<void> {
  if (!renderer) return;
  const job = renderJob + 1;
  renderJob = job;
  const example = currentExample(exampleSelect.value);
  const sdf = example.build();
  const grid = Number(stepsInput.value);
  overlay.textContent = `Rendering ${grid}^3 preview mesh...`;
  stepsInput.disabled = true;
  const start = performance.now();
  try {
    const preview = await generateMesh(sdf, {
      grid,
      bounds: example.bounds,
      preferGPU: true,
    });
    if (job !== renderJob) return;
    renderer.render(preview.triangles, preview.bounds);
    previewStat.textContent = `${(performance.now() - start).toFixed(1)} ms`;
    overlay.textContent = `Preview mesh: ${preview.triangles.length.toLocaleString()} triangles from a ${grid}^3 grid${preview.usedGPU ? " with WebGPU sampling" : " with CPU sampling"}.`;
  } catch (error) {
    overlay.textContent = error instanceof Error ? error.message : String(error);
    previewStat.textContent = "failed";
  } finally {
    if (job === renderJob) stepsInput.disabled = false;
  }
}

async function meshCurrent(): Promise<void> {
  const example = currentExample(exampleSelect.value);
  const sdf = example.build();
  meshButton.disabled = true;
  meshButton.textContent = "Building";
  overlay.textContent = "Sampling and polygonizing the SDF volume...";
  try {
    mesh = await generateMesh(sdf, {
      grid: Number(gridInput.value),
      bounds: example.bounds,
      preferGPU: true,
    });
    renderer?.render(mesh.triangles, mesh.bounds);
    lastBlob = binarySTL(mesh.triangles, `sdf-browser ${example.name}`);
    const total = mesh.sampleTimeMs + mesh.polygonizeTimeMs;
    meshStat.textContent = `${total.toFixed(0)} ms ${mesh.usedGPU ? "GPU" : "CPU"}`;
    triangleStat.textContent = mesh.triangles.length.toLocaleString();
    downloadButton.disabled = mesh.triangles.length === 0;
    overlay.textContent = `Generated ${mesh.triangles.length.toLocaleString()} triangles from a ${gridInput.value}^3 grid.`;
  } catch (error) {
    overlay.textContent = error instanceof Error ? error.message : String(error);
    meshStat.textContent = "failed";
  } finally {
    meshButton.disabled = false;
    meshButton.textContent = "Build STL";
  }
}
