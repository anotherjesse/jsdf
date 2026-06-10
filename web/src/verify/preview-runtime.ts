import { box, intersection, sphere, type SDF3 } from "../api";
import { generateMesh } from "../mesh/generate";
import { OrbitCamera } from "../preview/orbit-camera";
import { WebGLMeshRenderer } from "../preview/webgl-mesh-renderer";
import { WebGLRaymarchRenderer } from "../preview/webgl-raymarch-renderer";

export interface PreviewRuntimeVerification {
  ok: boolean;
  shader: CanvasDiagnostics;
  mesh: CanvasDiagnostics & {
    triangles: number;
    usedGPU: boolean;
    usedWorker: boolean;
    meshTimeMs: number;
  };
  errors: string[];
}

export interface CanvasDiagnostics {
  mode: string;
  width: number;
  height: number;
  sum: number;
  min: number;
  max: number;
  distinct: number;
}

const bounds: [number[], number[]] = [[-1.45, -1.45, -1.45], [1.45, 1.45, 1.45]];

export async function runPreviewRuntimeVerification(canvas: HTMLCanvasElement): Promise<PreviewRuntimeVerification> {
  const errors: string[] = [];
  const sdf = intersection(sphere(1), box(1.55)) as SDF3;
  const camera = new OrbitCamera(canvas, () => undefined);
  const shaderRenderer = new WebGLRaymarchRenderer(canvas, camera);
  const meshRenderer = new WebGLMeshRenderer(canvas, camera);

  meshRenderer.setActive(false);
  shaderRenderer.setActive(true);
  shaderRenderer.render(sdf, bounds, 176);
  const shader = diagnostics(canvas);
  verifyDiagnostics("shader", shader, "glsl-raymarch", errors);

  const meshStart = performance.now();
  const meshResult = await generateMesh(sdf, {
    algorithm: "surface-net",
    bounds,
    grid: 36,
    preferGPU: true,
    preferWorker: true,
  });
  const meshTimeMs = performance.now() - meshStart;

  shaderRenderer.setActive(false);
  meshRenderer.render(meshResult.triangles, meshResult.bounds);
  meshRenderer.setActive(true);
  const mesh = {
    ...diagnostics(canvas),
    triangles: meshResult.triangles.length,
    usedGPU: meshResult.usedGPU,
    usedWorker: meshResult.usedWorker,
    meshTimeMs,
  };
  verifyDiagnostics("mesh", mesh, "mesh", errors);
  if (mesh.triangles <= 0) errors.push("mesh preview generated no triangles");
  if (!mesh.usedWorker) errors.push("mesh preview did not use worker mesh generation");

  return {
    ok: errors.length === 0,
    shader,
    mesh,
    errors,
  };
}

function diagnostics(canvas: HTMLCanvasElement): CanvasDiagnostics {
  return {
    mode: canvas.dataset.previewMode ?? "",
    width: Number(canvas.dataset.previewWidth ?? canvas.width),
    height: Number(canvas.dataset.previewHeight ?? canvas.height),
    sum: Number(canvas.dataset.previewSum ?? 0),
    min: Number(canvas.dataset.previewMin ?? 0),
    max: Number(canvas.dataset.previewMax ?? 0),
    distinct: Number(canvas.dataset.previewDistinct ?? 0),
  };
}

function verifyDiagnostics(label: string, result: CanvasDiagnostics, expectedMode: string, errors: string[]): void {
  if (result.mode !== expectedMode) errors.push(`${label} preview mode mismatch: ${result.mode} !== ${expectedMode}`);
  if (result.width < 100 || result.height < 100) errors.push(`${label} preview canvas too small: ${result.width}x${result.height}`);
  if (result.sum <= 0) errors.push(`${label} preview has empty pixel sum`);
  if (result.max <= result.min) errors.push(`${label} preview has no sampled luminance range`);
  if (result.distinct < 2) errors.push(`${label} preview sampled too few distinct colors: ${result.distinct}`);
}
