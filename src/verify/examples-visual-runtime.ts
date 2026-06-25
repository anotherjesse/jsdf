import type { SDF3 } from "../core/nodes";
import { evaluateSource } from "../editor/evaluate-source";
import { sourceForExample } from "../editor/example-source";
import { examples } from "../examples";
import type { Bounds3 } from "../mesh/bounds";
import { OrbitCamera } from "../preview/orbit-camera";
import { WebGLRaymarchRenderer } from "../preview/webgl-raymarch-renderer";

export interface ExamplesVisualRuntimeVerification {
  ok: boolean;
  examples: ExampleVisualSummary[];
  totals: {
    rendered: number;
    renderMs: number;
    foregroundPixels: number;
    distinctColors: number;
  };
  errors: string[];
}

export interface ExampleVisualSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  renderMs: number;
  nodes: number;
  foregroundPixels: number;
  distinctColors: number;
  luminanceRange: number;
  programBuilds: number;
}

const FALLBACK_BOUNDS: Bounds3 = [[-2, -2, -2], [2, 2, 2]];
const RENDER_STEPS = 176;
const SAMPLE_COLUMNS = 19;
const SAMPLE_ROWS = 13;
const MIN_FOREGROUND_PIXELS = 2;
const MIN_DISTINCT_COLORS = 4;
const MIN_LUMINANCE_RANGE = 18;

export async function runExamplesVisualRuntimeVerification(
  canvas: HTMLCanvasElement,
  gallery?: HTMLElement | null,
): Promise<ExamplesVisualRuntimeVerification> {
  const errors: string[] = [];
  const camera = new OrbitCamera(canvas, () => undefined);
  const renderer = new WebGLRaymarchRenderer(canvas, camera);
  const summaries: ExampleVisualSummary[] = [];
  const start = performance.now();

  gallery?.replaceChildren();

  for (const example of examples) {
    try {
      const source = sourceForExample(example.id);
      const { sdf } = evaluateSource(source);
      const bounds = (example.bounds ?? FALLBACK_BOUNDS) as Bounds3;
      const renderStart = performance.now();
      renderer.render(sdf, bounds, RENDER_STEPS);
      const renderMs = performance.now() - renderStart;
      const pixels = sampleCanvas(canvas);
      const summary: ExampleVisualSummary = {
        id: example.id,
        name: example.name,
        width: canvas.width,
        height: canvas.height,
        renderMs,
        nodes: countNodes(sdf),
        foregroundPixels: pixels.foregroundPixels,
        distinctColors: pixels.distinctColors,
        luminanceRange: pixels.luminanceRange,
        programBuilds: Number(canvas.dataset.programBuilds ?? 0),
      };
      summaries.push(summary);
      const errorCountBeforeVisualCheck = errors.length;
      verifyExampleVisual(summary, errors);
      gallery?.append(renderExampleCard(summary, canvas, errors.length === errorCountBeforeVisualCheck));
      await nextFrame();
    } catch (error) {
      errors.push(`example ${example.id} failed visual render: ${error instanceof Error ? error.message : String(error)}`);
      gallery?.append(renderFailedExampleCard(example.name));
    }
  }

  return {
    ok: errors.length === 0,
    examples: summaries,
    totals: {
      rendered: summaries.length,
      renderMs: performance.now() - start,
      foregroundPixels: summaries.reduce((sum, example) => sum + example.foregroundPixels, 0),
      distinctColors: summaries.reduce((sum, example) => sum + example.distinctColors, 0),
    },
    errors,
  };
}

function verifyExampleVisual(summary: ExampleVisualSummary, errors: string[]): void {
  if (summary.width < 100 || summary.height < 100) {
    errors.push(`example ${summary.id} rendered too small: ${summary.width}x${summary.height}`);
  }
  if (summary.foregroundPixels < MIN_FOREGROUND_PIXELS) {
    errors.push(`example ${summary.id} had too few foreground samples: ${summary.foregroundPixels}`);
  }
  if (summary.distinctColors < MIN_DISTINCT_COLORS) {
    errors.push(`example ${summary.id} sampled too few distinct colors: ${summary.distinctColors}`);
  }
  if (summary.luminanceRange < MIN_LUMINANCE_RANGE) {
    errors.push(`example ${summary.id} had low luminance range: ${summary.luminanceRange}`);
  }
}

function sampleCanvas(canvas: HTMLCanvasElement): {
  foregroundPixels: number;
  distinctColors: number;
  luminanceRange: number;
} {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 is not available for example visual sampling.");

  const pixel = new Uint8Array(4);
  const colors: string[] = [];
  for (let row = 0; row < SAMPLE_ROWS; row += 1) {
    for (let column = 0; column < SAMPLE_COLUMNS; column += 1) {
      const x = Math.round((column + 0.5) / SAMPLE_COLUMNS * (canvas.width - 1));
      const y = Math.round((row + 0.5) / SAMPLE_ROWS * (canvas.height - 1));
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      colors.push(`${pixel[0]},${pixel[1]},${pixel[2]}`);
    }
  }

  const background = colors[0] ?? "0,0,0";
  const luminances = colors.map(luminanceForColor);
  const foregroundPixels = colors.filter((color) => colorDistance(color, background) > 26).length;
  return {
    foregroundPixels,
    distinctColors: new Set(colors).size,
    luminanceRange: Math.max(...luminances) - Math.min(...luminances),
  };
}

function luminanceForColor(color: string): number {
  const [r, g, b] = color.split(",").map(Number);
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = a.split(",").map(Number);
  const [br, bg, bb] = b.split(",").map(Number);
  return Math.abs((ar ?? 0) - (br ?? 0))
    + Math.abs((ag ?? 0) - (bg ?? 0))
    + Math.abs((ab ?? 0) - (bb ?? 0));
}

function renderExampleCard(summary: ExampleVisualSummary, canvas: HTMLCanvasElement, ok: boolean): HTMLElement {
  const card = document.createElement("article");
  card.className = "example-card";
  card.dataset.ok = String(ok);

  const image = document.createElement("img");
  image.alt = summary.name;
  image.src = canvas.toDataURL("image/png");

  const title = document.createElement("strong");
  title.textContent = summary.name;

  const meta = document.createElement("span");
  meta.className = "example-meta";
  meta.textContent = `${summary.nodes} nodes, ${summary.foregroundPixels} fg, ${summary.renderMs.toFixed(0)} ms`;

  card.append(image, title, meta);
  return card;
}

function renderFailedExampleCard(name: string): HTMLElement {
  const card = document.createElement("article");
  card.className = "example-card";
  card.dataset.ok = "false";
  const title = document.createElement("strong");
  title.textContent = name;
  const meta = document.createElement("span");
  meta.className = "example-meta";
  meta.textContent = "Render failed";
  card.append(title, meta);
  return card;
}

function countNodes(sdf: SDF3): number {
  const seen = new Set<number>();
  const visit = (node: SDF3["node"]) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    for (const child of node.children) visit(child.node);
  };
  visit(sdf.node);
  return seen.size;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
