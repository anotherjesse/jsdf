import type { SDF3 } from "./core/nodes";
import { evaluate3 } from "./evaluate";
import { estimateBounds, paddedBounds, type Bounds3 } from "./mesh/bounds";
import { generateMesh, type MeshOptions, type MeshResult } from "./mesh/generate";
import { write_binary_stl } from "./mesh/stl";

export interface SaveOptions extends MeshOptions {
  download?: boolean;
  name?: string;
}

export interface SliceOptions {
  w?: number;
  h?: number;
  x?: number | null;
  y?: number | null;
  z?: number | null;
  bounds?: Bounds3;
}

export interface SliceSample {
  values: Float32Array;
  width: number;
  height: number;
  extent: [number, number, number, number];
  axes: "ZY" | "ZX" | "YX";
  fixedAxis: "x" | "y" | "z";
  fixedValue: number;
  bounds: Bounds3;
}

export interface ShowSliceOptions extends SliceOptions {
  abs?: boolean;
  canvas?: HTMLCanvasElement;
}

export async function generate(sdf: SDF3, options: MeshOptions = {}): Promise<MeshResult> {
  return generateMesh(sdf, options);
}

export async function save(filename: string, sdf: SDF3, options: SaveOptions = {}): Promise<Blob> {
  if (!filename.toLowerCase().endsWith(".stl")) {
    throw new Error("browser save currently supports .stl exports");
  }
  const mesh = await generateMesh(sdf, options);
  return write_binary_stl(filename, mesh, {
    download: options.download,
    name: options.name ?? filename,
  });
}

export function sample_slice(sdf: SDF3, options: SliceOptions = {}): SliceSample {
  const width = positiveInt(options.w ?? 1024, "slice width");
  const height = positiveInt(options.h ?? 1024, "slice height");
  const bounds = options.bounds ?? paddedBounds(estimateBounds(sdf));
  const [lo, hi] = bounds;
  const values = new Float32Array(width * height);

  const plane = slicePlane(options, bounds);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      values[row * width + col] = evaluate3(sdf, plane.point(col, row, width, height));
    }
  }

  return {
    values,
    width,
    height,
    extent: plane.extent,
    axes: plane.axes,
    fixedAxis: plane.fixedAxis,
    fixedValue: plane.fixedValue,
    bounds: [lo, hi],
  };
}

export function show_slice(sdf: SDF3, options: ShowSliceOptions = {}): HTMLCanvasElement {
  const { abs = false, canvas, ...sliceOptions } = options;
  if (!canvas && typeof document === "undefined") {
    throw new Error("show_slice requires a browser document or an explicit canvas");
  }

  const sample = sample_slice(sdf, sliceOptions);
  const target = canvas ?? document.createElement("canvas");
  target.width = sample.width;
  target.height = sample.height;

  const context = target.getContext("2d");
  if (!context) throw new Error("2D canvas context is unavailable");

  const image = context.createImageData(sample.width, sample.height);
  const maxAbs = maxFiniteAbs(sample.values);
  let min = Infinity;
  let max = -Infinity;
  const distinct = new Set<number>();

  for (let row = 0; row < sample.height; row += 1) {
    const sourceRow = sample.height - 1 - row;
    for (let col = 0; col < sample.width; col += 1) {
      const value = sample.values[sourceRow * sample.width + col];
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      const color = abs ? absoluteColor(value, maxAbs) : signedColor(value, maxAbs);
      const offset = (row * sample.width + col) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
      distinct.add((color[0] << 16) | (color[1] << 8) | color[2]);
    }
  }

  context.putImageData(image, 0, 0);
  target.dataset.sdfSliceAxes = sample.axes;
  target.dataset.sdfSliceWidth = String(sample.width);
  target.dataset.sdfSliceHeight = String(sample.height);
  target.dataset.sdfSliceMin = String(Number.isFinite(min) ? min : 0);
  target.dataset.sdfSliceMax = String(Number.isFinite(max) ? max : 0);
  target.dataset.sdfSliceDistinct = String(distinct.size);
  return target;
}

interface PlaneSpec {
  axes: SliceSample["axes"];
  fixedAxis: SliceSample["fixedAxis"];
  fixedValue: number;
  extent: SliceSample["extent"];
  point: (col: number, row: number, width: number, height: number) => [number, number, number];
}

function slicePlane(options: SliceOptions, bounds: Bounds3): PlaneSpec {
  const [lo, hi] = bounds;
  if (options.x != null) {
    return {
      axes: "ZY",
      fixedAxis: "x",
      fixedValue: options.x,
      extent: [lo[2], hi[2], lo[1], hi[1]],
      point: (col, row, width, height) => [
        options.x as number,
        lerpIndex(lo[1], hi[1], row, height),
        lerpIndex(lo[2], hi[2], col, width),
      ],
    };
  }
  if (options.y != null) {
    return {
      axes: "ZX",
      fixedAxis: "y",
      fixedValue: options.y,
      extent: [lo[2], hi[2], lo[0], hi[0]],
      point: (col, row, width, height) => [
        lerpIndex(lo[0], hi[0], row, height),
        options.y as number,
        lerpIndex(lo[2], hi[2], col, width),
      ],
    };
  }
  if (options.z != null) {
    return {
      axes: "YX",
      fixedAxis: "z",
      fixedValue: options.z,
      extent: [lo[1], hi[1], lo[0], hi[0]],
      point: (col, row, width, height) => [
        lerpIndex(lo[0], hi[0], row, height),
        lerpIndex(lo[1], hi[1], col, width),
        options.z as number,
      ],
    };
  }
  throw new Error("x, y, or z position must be specified");
}

function positiveInt(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 1) throw new Error(`invalid ${label}: ${value}`);
  return Math.max(1, Math.floor(value));
}

function lerpIndex(lo: number, hi: number, index: number, count: number): number {
  return count <= 1 ? (lo + hi) / 2 : lo + (hi - lo) * (index / (count - 1));
}

function maxFiniteAbs(values: Float32Array): number {
  let max = 0;
  for (const value of values) {
    if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
  }
  return max || 1;
}

function absoluteColor(value: number, maxAbs: number): [number, number, number] {
  const t = clamp01(Math.abs(finiteOrZero(value)) / maxAbs);
  return [
    Math.round(18 + 222 * t),
    Math.round(28 + 210 * (1 - Math.abs(t - 0.45))),
    Math.round(40 + 135 * (1 - t)),
  ];
}

function signedColor(value: number, maxAbs: number): [number, number, number] {
  const v = clamp01(0.5 + finiteOrZero(value) / (maxAbs * 2));
  if (v < 0.5) return mixColor([36, 181, 168], [238, 242, 246], v * 2);
  return mixColor([238, 242, 246], [218, 102, 84], (v - 0.5) * 2);
}

function mixColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const u = clamp01(t);
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
