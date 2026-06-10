import { box, intersection, sphere, type SDF3 } from "../api";
import { generateMesh } from "../mesh/generate";
import { OrbitCamera } from "../preview/orbit-camera";
import { viewPanels } from "../preview/view-layout";
import { WebGLMeshRenderer } from "../preview/webgl-mesh-renderer";
import { WebGLRaymarchRenderer } from "../preview/webgl-raymarch-renderer";

export interface PreviewRuntimeVerification {
  ok: boolean;
  shader: CanvasDiagnostics;
  highlight: HighlightDiagnostics;
  mesh: CanvasDiagnostics & {
    triangles: number;
    usedGPU: boolean;
    usedWorker: boolean;
    meshTimeMs: number;
  };
  quadLabels: string[];
  errors: string[];
}

export interface HighlightDiagnostics {
  initialProgramBuilds: number;
  markProgramBuilds: number;
  focusProgramBuilds: number;
  markNode: string;
  focusNode: string;
  markMode: string;
  focusMode: string;
}

export interface CanvasDiagnostics {
  mode: string;
  width: number;
  height: number;
  sum: number;
  min: number;
  max: number;
  distinct: number;
  programBuilds: number;
  highlightNode: string;
  highlightMode: string;
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
  const highlight = verifyHighlightUniforms(shaderRenderer, sdf, canvas, errors);

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

  const quadLabels = viewPanels("quad", 800, 600).map((panel) => panel.label);
  if (quadLabels.join(",") !== "Orbit,Top Z,Right X,Front Y") {
    errors.push(`quad preview labels mismatch: ${quadLabels.join(",")}`);
  }

  return {
    ok: errors.length === 0,
    shader,
    highlight,
    mesh,
    quadLabels,
    errors,
  };
}

function verifyHighlightUniforms(
  shaderRenderer: WebGLRaymarchRenderer,
  sdf: SDF3,
  canvas: HTMLCanvasElement,
  errors: string[],
): HighlightDiagnostics {
  const markNode = sdf.node.children[0]?.node;
  const focusNode = sdf.node.children[1]?.node;
  if (!markNode || !focusNode) {
    errors.push("highlight verification fixture is missing child nodes");
    return {
      initialProgramBuilds: Number(canvas.dataset.programBuilds ?? 0),
      markProgramBuilds: 0,
      focusProgramBuilds: 0,
      markNode: "",
      focusNode: "",
      markMode: "",
      focusMode: "",
    };
  }

  const initialProgramBuilds = Number(canvas.dataset.programBuilds ?? 0);
  shaderRenderer.render(sdf, bounds, 176, markNode, "mark");
  const mark = diagnostics(canvas);
  shaderRenderer.render(sdf, bounds, 176, focusNode, "focus");
  const focus = diagnostics(canvas);

  if (initialProgramBuilds <= 0) errors.push("shader preview did not record an initial program build");
  if (mark.programBuilds !== initialProgramBuilds) {
    errors.push(`mark highlight rebuilt shader program: ${mark.programBuilds} !== ${initialProgramBuilds}`);
  }
  if (focus.programBuilds !== initialProgramBuilds) {
    errors.push(`focus highlight rebuilt shader program: ${focus.programBuilds} !== ${initialProgramBuilds}`);
  }
  if (mark.highlightNode !== String(markNode.id)) {
    errors.push(`mark highlight node mismatch: ${mark.highlightNode} !== ${markNode.id}`);
  }
  if (mark.highlightMode !== "mark") errors.push(`mark highlight mode mismatch: ${mark.highlightMode}`);
  if (focus.highlightNode !== String(focusNode.id)) {
    errors.push(`focus highlight node mismatch: ${focus.highlightNode} !== ${focusNode.id}`);
  }
  if (focus.highlightMode !== "focus") errors.push(`focus highlight mode mismatch: ${focus.highlightMode}`);

  return {
    initialProgramBuilds,
    markProgramBuilds: mark.programBuilds,
    focusProgramBuilds: focus.programBuilds,
    markNode: mark.highlightNode,
    focusNode: focus.highlightNode,
    markMode: mark.highlightMode,
    focusMode: focus.highlightMode,
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
    programBuilds: Number(canvas.dataset.programBuilds ?? 0),
    highlightNode: canvas.dataset.highlightNode ?? "",
    highlightMode: canvas.dataset.highlightMode ?? "",
  };
}

function verifyDiagnostics(label: string, result: CanvasDiagnostics, expectedMode: string, errors: string[]): void {
  if (result.mode !== expectedMode) errors.push(`${label} preview mode mismatch: ${result.mode} !== ${expectedMode}`);
  if (result.width < 100 || result.height < 100) errors.push(`${label} preview canvas too small: ${result.width}x${result.height}`);
  if (result.sum <= 0) errors.push(`${label} preview has empty pixel sum`);
  if (result.max <= result.min) errors.push(`${label} preview has no sampled luminance range`);
  if (result.distinct < 2) errors.push(`${label} preview sampled too few distinct colors: ${result.distinct}`);
}
