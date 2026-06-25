import { box, intersection, sphere, union, type SDF3 } from "../api";
import { generateMesh } from "../mesh/generate";
import { HIGHLIGHT_PALETTE } from "../preview/highlight-style";
import { OrbitCamera } from "../preview/orbit-camera";
import { viewPanels } from "../preview/view-layout";
import { WebGLMeshRenderer } from "../preview/webgl-mesh-renderer";
import { WebGLRaymarchRenderer } from "../preview/webgl-raymarch-renderer";

export interface PreviewRuntimeVerification {
  ok: boolean;
  shader: CanvasDiagnostics;
  colorShader: ColorCanvasDiagnostics;
  highlight: HighlightDiagnostics;
  mesh: CanvasDiagnostics & {
    triangles: number;
    usedGPU: boolean;
    usedWorker: boolean;
    meshTimeMs: number;
  };
  colorMesh: ColorCanvasDiagnostics & {
    triangles: number;
    usedGPU: boolean;
    usedWorker: boolean;
  };
  meshHighlight: {
    markNode: string;
    focusNode: string;
    markMode: string;
    focusMode: string;
    markStyle: string;
    focusStyle: string;
    markPalette: string;
    focusPalette: string;
    markProgramBuilds: number;
    focusProgramBuilds: number;
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
  markStyle: string;
  focusStyle: string;
  markPalette: string;
  focusPalette: string;
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
  highlightKind: string;
  highlightMode: string;
  highlightStyle: string;
  highlightPalette: string;
}

export interface ColorCanvasDiagnostics extends CanvasDiagnostics {
  redPixels: number;
  greenPixels: number;
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
  const colorShader = verifyColoredShaderPreview(shaderRenderer, canvas, errors);

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
  const meshMarkNode = sdf.node.children[0]?.node ?? null;
  const meshFocusNode = sdf.node.children[1]?.node ?? null;
  meshRenderer.render(meshResult.triangles, meshResult.bounds, sdf, meshMarkNode, "mark");
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
  if (meshMarkNode && mesh.highlightNode !== String(meshMarkNode.id)) {
    errors.push(`mesh mark highlight node mismatch: ${mesh.highlightNode} !== ${meshMarkNode.id}`);
  }
  if (meshMarkNode && mesh.highlightMode !== "mark") errors.push(`mesh mark highlight mode mismatch: ${mesh.highlightMode}`);
  if (meshMarkNode && mesh.highlightStyle !== "outline") {
    errors.push(`mesh mark highlight style mismatch: ${mesh.highlightStyle}`);
  }
  if (meshMarkNode && mesh.highlightPalette !== HIGHLIGHT_PALETTE) {
    errors.push(`mesh mark highlight palette mismatch: ${mesh.highlightPalette}`);
  }

  meshRenderer.setHighlight(sdf, meshFocusNode, "focus");
  const meshFocus = diagnostics(canvas);
  if (meshFocusNode && meshFocus.highlightNode !== String(meshFocusNode.id)) {
    errors.push(`mesh focus highlight node mismatch: ${meshFocus.highlightNode} !== ${meshFocusNode.id}`);
  }
  if (meshFocusNode && meshFocus.highlightMode !== "focus") errors.push(`mesh focus highlight mode mismatch: ${meshFocus.highlightMode}`);
  if (meshFocusNode && meshFocus.highlightStyle !== "focus-fade") {
    errors.push(`mesh focus highlight style mismatch: ${meshFocus.highlightStyle}`);
  }
  if (meshFocusNode && meshFocus.highlightPalette !== HIGHLIGHT_PALETTE) {
    errors.push(`mesh focus highlight palette mismatch: ${meshFocus.highlightPalette}`);
  }
  if (meshFocus.programBuilds !== mesh.programBuilds) {
    errors.push(`mesh focus highlight rebuilt shader program: ${meshFocus.programBuilds} !== ${mesh.programBuilds}`);
  }
  const colorMesh = await verifyColoredMeshPreview(meshRenderer, canvas, errors);

  const quadLabels = viewPanels("quad", 800, 600).map((panel) => panel.label);
  if (quadLabels.join(",") !== "Orbit,Top Z,Right X,Front Y") {
    errors.push(`quad preview labels mismatch: ${quadLabels.join(",")}`);
  }

  return {
    ok: errors.length === 0,
    shader,
    colorShader,
    highlight,
    mesh,
    colorMesh,
    meshHighlight: {
      markNode: mesh.highlightNode,
      focusNode: meshFocus.highlightNode,
      markMode: mesh.highlightMode,
      focusMode: meshFocus.highlightMode,
      markStyle: mesh.highlightStyle,
      focusStyle: meshFocus.highlightStyle,
      markPalette: mesh.highlightPalette,
      focusPalette: meshFocus.highlightPalette,
      markProgramBuilds: mesh.programBuilds,
      focusProgramBuilds: meshFocus.programBuilds,
    },
    quadLabels,
    errors,
  };
}

function verifyColoredShaderPreview(
  renderer: WebGLRaymarchRenderer,
  canvas: HTMLCanvasElement,
  errors: string[],
): ColorCanvasDiagnostics {
  const colored = union(
    sphere(0.72).translate([-0.58, 0, 0]).name("red").color("#ef4444"),
    sphere(0.72).translate([0.58, 0, 0]).name("green").color("#22c55e"),
  ) as SDF3;
  renderer.render(colored, [[-1.55, -1.2, -1.1], [1.55, 1.2, 1.1]], 176);
  const base = diagnostics(canvas);
  const colorSamples = colorFamilyCounts(canvas);
  if (base.mode !== "glsl-raymarch") errors.push(`colored shader preview mode mismatch: ${base.mode}`);
  if (colorSamples.redPixels <= 0) errors.push("colored shader preview did not expose red pixels");
  if (colorSamples.greenPixels <= 0) errors.push("colored shader preview did not expose green pixels");
  return {
    ...base,
    redPixels: colorSamples.redPixels,
    greenPixels: colorSamples.greenPixels,
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
      markStyle: "",
      focusStyle: "",
      markPalette: "",
      focusPalette: "",
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
  if (mark.highlightStyle !== "outline") errors.push(`mark highlight style mismatch: ${mark.highlightStyle}`);
  if (mark.highlightPalette !== HIGHLIGHT_PALETTE) errors.push(`mark highlight palette mismatch: ${mark.highlightPalette}`);
  if (focus.highlightNode !== String(focusNode.id)) {
    errors.push(`focus highlight node mismatch: ${focus.highlightNode} !== ${focusNode.id}`);
  }
  if (focus.highlightMode !== "focus") errors.push(`focus highlight mode mismatch: ${focus.highlightMode}`);
  if (focus.highlightStyle !== "focus-fade") errors.push(`focus highlight style mismatch: ${focus.highlightStyle}`);
  if (focus.highlightPalette !== HIGHLIGHT_PALETTE) errors.push(`focus highlight palette mismatch: ${focus.highlightPalette}`);

  return {
    initialProgramBuilds,
    markProgramBuilds: mark.programBuilds,
    focusProgramBuilds: focus.programBuilds,
    markNode: mark.highlightNode,
    focusNode: focus.highlightNode,
    markMode: mark.highlightMode,
    focusMode: focus.highlightMode,
    markStyle: mark.highlightStyle,
    focusStyle: focus.highlightStyle,
    markPalette: mark.highlightPalette,
    focusPalette: focus.highlightPalette,
  };
}

async function verifyColoredMeshPreview(
  renderer: WebGLMeshRenderer,
  canvas: HTMLCanvasElement,
  errors: string[],
): Promise<ColorCanvasDiagnostics & { triangles: number; usedGPU: boolean; usedWorker: boolean }> {
  const colored = union(
    sphere(0.72).translate([-0.58, 0, 0]).name("red").color("#ef4444"),
    sphere(0.72).translate([0.58, 0, 0]).name("green").color("#22c55e"),
  ) as SDF3;
  const meshResult = await generateMesh(colored, {
    algorithm: "surface-net",
    bounds: [[-1.55, -1.2, -1.1], [1.55, 1.2, 1.1]],
    grid: 32,
    preferGPU: true,
    preferWorker: true,
  });
  renderer.render(meshResult.triangles, meshResult.bounds, colored);
  const base = diagnostics(canvas);
  const colorSamples = colorFamilyCounts(canvas);
  if (base.mode !== "mesh") errors.push(`colored mesh preview mode mismatch: ${base.mode}`);
  if (meshResult.triangles.length <= 0) errors.push("colored mesh preview generated no triangles");
  if (colorSamples.redPixels <= 0) errors.push("colored mesh preview did not expose red pixels");
  if (colorSamples.greenPixels <= 0) errors.push("colored mesh preview did not expose green pixels");
  return {
    ...base,
    redPixels: colorSamples.redPixels,
    greenPixels: colorSamples.greenPixels,
    triangles: meshResult.triangles.length,
    usedGPU: meshResult.usedGPU,
    usedWorker: meshResult.usedWorker,
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
    highlightKind: canvas.dataset.highlightKind ?? "",
    highlightMode: canvas.dataset.highlightMode ?? "",
    highlightStyle: canvas.dataset.highlightStyle ?? "",
    highlightPalette: canvas.dataset.highlightPalette ?? "",
  };
}

function verifyDiagnostics(label: string, result: CanvasDiagnostics, expectedMode: string, errors: string[]): void {
  if (result.mode !== expectedMode) errors.push(`${label} preview mode mismatch: ${result.mode} !== ${expectedMode}`);
  if (result.width < 100 || result.height < 100) errors.push(`${label} preview canvas too small: ${result.width}x${result.height}`);
  if (result.sum <= 0) errors.push(`${label} preview has empty pixel sum`);
  if (result.max <= result.min) errors.push(`${label} preview has no sampled luminance range`);
  if (result.distinct < 2) errors.push(`${label} preview sampled too few distinct colors: ${result.distinct}`);
}

function colorFamilyCounts(canvas: HTMLCanvasElement): { redPixels: number; greenPixels: number } {
  const gl = canvas.getContext("webgl2");
  if (!gl) return { redPixels: 0, greenPixels: 0 };
  const pixel = new Uint8Array(4);
  let redPixels = 0;
  let greenPixels = 0;
  for (let y = 0.25; y <= 0.75; y += 0.1) {
    for (let x = 0.2; x <= 0.8; x += 0.075) {
      const px = Math.max(0, Math.min(canvas.width - 1, Math.floor(x * canvas.width)));
      const py = Math.max(0, Math.min(canvas.height - 1, Math.floor(y * canvas.height)));
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (pixel[0] > pixel[1] * 1.15 && pixel[0] > pixel[2] * 1.25) redPixels += 1;
      if (pixel[1] > pixel[0] * 1.1 && pixel[1] > pixel[2] * 1.1) greenPixels += 1;
    }
  }
  return { redPixels, greenPixels };
}
