import type { SDF3 } from "../core/nodes";
import { evaluate3 } from "../evaluate";
import { sampleFieldWebGPU, type VolumeSample } from "../gpu/sampler";
import { estimateBounds, paddedBounds, type Bounds3 } from "./bounds";
import { polygonizeVolume, type Triangle } from "./polygonize";

export interface MeshResult {
  triangles: Triangle[];
  bounds: Bounds3;
  sampleTimeMs: number;
  polygonizeTimeMs: number;
  usedGPU: boolean;
}

export interface MeshOptions {
  grid?: number;
  bounds?: Bounds3;
  preferGPU?: boolean;
}

export async function generateMesh(sdf: SDF3, options: MeshOptions = {}): Promise<MeshResult> {
  const grid = options.grid ?? 52;
  const dims: [number, number, number] = [grid, grid, grid];
  const bounds = options.bounds ?? paddedBounds(estimateBounds(sdf));
  let volume: VolumeSample;
  let usedGPU = false;

  if (options.preferGPU !== false) {
    try {
      volume = await sampleFieldWebGPU(sdf, dims, bounds);
      usedGPU = true;
    } catch {
      volume = sampleFieldCPU(sdf, dims, bounds);
    }
  } else {
    volume = sampleFieldCPU(sdf, dims, bounds);
  }

  const start = performance.now();
  const triangles = polygonizeVolume(volume);
  return {
    triangles,
    bounds,
    sampleTimeMs: volume.gpuTimeMs,
    polygonizeTimeMs: performance.now() - start,
    usedGPU,
  };
}

function sampleFieldCPU(sdf: SDF3, dims: [number, number, number], bounds: Bounds3): VolumeSample {
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
export * from "./stl";
