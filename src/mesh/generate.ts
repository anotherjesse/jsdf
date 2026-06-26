import type { SDF3 } from "../core/nodes";
import { evaluate3 } from "../evaluate";
import { sampleFieldWebGPU, type VolumeSample } from "../gpu/sampler";
import { estimateBounds, paddedBounds, type Bounds3 } from "./bounds";
import { isTriangleLimitError, polygonizeVolume, type Triangle } from "./polygonize";
import { surfaceNetVolume } from "./surface-net";

export type MeshAlgorithm = "surface-net" | "tetra";
export type MeshDims = [number, number, number];

export interface MeshResult {
  triangles: Triangle[];
  bounds: Bounds3;
  dims: MeshDims;
  sampleTimeMs: number;
  polygonizeTimeMs: number;
  usedGPU: boolean;
  usedWorker: boolean;
  algorithm: MeshAlgorithm;
}

export interface MeshOptions {
  grid?: number;
  dims?: MeshDims;
  step?: number | ArrayLike<number>;
  samples?: number;
  bounds?: Bounds3;
  preferGPU?: boolean;
  preferWorker?: boolean;
  workers?: number;
  batch_size?: number;
  batchSize?: number;
  verbose?: boolean;
  sparse?: boolean;
  algorithm?: MeshAlgorithm;
  maxTriangles?: number;
}

export async function generateMesh(sdf: SDF3, options: MeshOptions = {}): Promise<MeshResult> {
  const algorithm = options.algorithm ?? "surface-net";
  const bounds = options.bounds ?? paddedBounds(estimateBounds(sdf));
  const dims = resolveDims(options, bounds);
  const preferWorker = options.preferWorker !== false && options.workers !== 1;
  let volume: VolumeSample;
  let usedGPU = false;

  if (options.preferGPU !== false) {
    try {
      volume = await sampleFieldWebGPU(sdf, dims, bounds);
      usedGPU = true;
    } catch (error) {
      if (preferWorker && typeof Worker !== "undefined") {
        try {
          return await generateInWorker(sdf, { algorithm, bounds, dims, maxTriangles: options.maxTriangles });
        } catch (workerError) {
          if (isTriangleLimitError(workerError)) throw workerError;
        }
      }
      volume = sampleFieldCPU(sdf, dims, bounds);
    }
  } else {
    if (preferWorker && typeof Worker !== "undefined") {
      try {
        return await generateInWorker(sdf, { algorithm, bounds, dims, maxTriangles: options.maxTriangles });
      } catch (workerError) {
        if (isTriangleLimitError(workerError)) throw workerError;
      }
    }
    volume = sampleFieldCPU(sdf, dims, bounds);
  }

  const polygonized = await polygonize(volume, algorithm, preferWorker, options.maxTriangles);
  return {
    triangles: polygonized.triangles,
    bounds,
    dims,
    sampleTimeMs: volume.gpuTimeMs,
    polygonizeTimeMs: polygonized.polygonizeTimeMs,
    usedGPU,
    usedWorker: polygonized.usedWorker,
    algorithm,
  };
}

async function polygonize(volume: VolumeSample, algorithm: MeshAlgorithm, preferWorker: boolean, maxTriangles?: number): Promise<{ triangles: Triangle[]; polygonizeTimeMs: number; usedWorker: boolean }> {
  if (preferWorker && typeof Worker !== "undefined") {
    try {
      return await polygonizeInWorker(volume, algorithm, maxTriangles);
    } catch (error) {
      if (isTriangleLimitError(error)) throw error;
      // Fall back to the synchronous implementation if the worker cannot start.
    }
  }

  const start = performance.now();
  return {
    triangles: polygonizeSync(volume, algorithm, maxTriangles),
    polygonizeTimeMs: performance.now() - start,
    usedWorker: false,
  };
}

function polygonizeInWorker(volume: VolumeSample, algorithm: MeshAlgorithm, maxTriangles?: number): Promise<{ triangles: Triangle[]; polygonizeTimeMs: number; usedWorker: boolean }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./polygonize-worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<{ triangles?: Triangle[]; polygonizeTimeMs?: number; error?: string }>) => {
      cleanup();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      resolve({
        triangles: event.data.triangles ?? [],
        polygonizeTimeMs: event.data.polygonizeTimeMs ?? 0,
        usedWorker: true,
      });
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Mesh worker failed."));
    };

    const values = transferableBuffer(volume.values);
    worker.postMessage({
      algorithm,
      values,
      dims: volume.dims,
      bounds: volume.bounds,
      step: volume.step,
      maxTriangles,
    }, [values]);
  });
}

function generateInWorker(
  sdf: SDF3,
  request: { algorithm: MeshAlgorithm; bounds: Bounds3; dims: MeshDims; maxTriangles?: number },
): Promise<MeshResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./generate-worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<{ result?: MeshResult; error?: string }>) => {
      cleanup();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      if (!event.data.result) {
        reject(new Error("Mesh worker returned no result."));
        return;
      }
      resolve(event.data.result);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Mesh worker failed."));
    };

    worker.postMessage({
      sdf,
      algorithm: request.algorithm,
      bounds: request.bounds,
      dims: request.dims,
      maxTriangles: request.maxTriangles,
    });
  });
}

function polygonizeSync(volume: VolumeSample, algorithm: MeshAlgorithm, maxTriangles?: number): Triangle[] {
  const options = { maxTriangles };
  return algorithm === "surface-net" ? surfaceNetVolume(volume, options) : polygonizeVolume(volume, options);
}

function transferableBuffer(values: Float32Array): ArrayBuffer {
  if (values.byteOffset === 0 && values.byteLength === values.buffer.byteLength) {
    return values.buffer as ArrayBuffer;
  }
  return values.slice().buffer;
}

function resolveDims(options: MeshOptions, bounds: Bounds3): MeshDims {
  if (options.dims) return sanitizeDims(options.dims);
  if (options.step != null) return dimsFromStep(bounds, stepVector(options.step));
  if (options.samples != null) {
    const span = [
      bounds[1][0] - bounds[0][0],
      bounds[1][1] - bounds[0][1],
      bounds[1][2] - bounds[0][2],
    ];
    const volume = Math.max(span[0] * span[1] * span[2], Number.EPSILON);
    const step = Math.cbrt(volume / options.samples);
    return dimsFromStep(bounds, [step, step, step]);
  }
  const grid = options.grid ?? 52;
  return sanitizeDims([grid, grid, grid]);
}

function sanitizeDims(dims: ArrayLike<number>): MeshDims {
  const out = [dims[0], dims[1], dims[2]].map((value) => {
    if (!Number.isFinite(value) || value < 2) throw new Error(`invalid mesh dimension: ${value}`);
    return Math.max(2, Math.floor(value));
  });
  return [out[0], out[1], out[2]];
}

function stepVector(step: number | ArrayLike<number>): MeshDims {
  if (typeof step === "number") return sanitizeStep([step, step, step]);
  return sanitizeStep([step[0], step[1], step[2]]);
}

function sanitizeStep(step: ArrayLike<number>): MeshDims {
  const out = [step[0], step[1], step[2]].map((value) => {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid mesh step: ${value}`);
    return value;
  });
  return [out[0], out[1], out[2]];
}

function dimsFromStep(bounds: Bounds3, step: MeshDims): MeshDims {
  return sanitizeDims([
    Math.ceil((bounds[1][0] - bounds[0][0]) / step[0]) + 1,
    Math.ceil((bounds[1][1] - bounds[0][1]) / step[1]) + 1,
    Math.ceil((bounds[1][2] - bounds[0][2]) / step[2]) + 1,
  ]);
}

function sampleFieldCPU(sdf: SDF3, dims: MeshDims, bounds: Bounds3): VolumeSample {
  const start = performance.now();
  const [nx, ny, nz] = dims;
  const min = bounds[0];
  const max = bounds[1];
  const step: [number, number, number] = [
    (max[0] - min[0]) / (nx - 1),
    (max[1] - min[1]) / (ny - 1),
    (max[2] - min[2]) / (nz - 1),
  ];
  const values = new Float32Array(nx * ny * nz);
  let index = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        values[index] = evaluate3(sdf, [min[0] + x * step[0], min[1] + y * step[1], min[2] + z * step[2]]);
        index += 1;
      }
    }
  }
  return { values, dims, bounds, step, gpuTimeMs: performance.now() - start };
}

export * from "./bounds";
export * from "./polygonize";
export * from "./surface-net";
export * from "./stl";
