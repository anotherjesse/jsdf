import { SDF2, SDF3, type Dim, type Node, type NodeKind, type SDF } from "../core/nodes";
import { evaluate3 } from "../evaluate";
import type { VolumeSample } from "../gpu/sampler";
import type { Bounds3 } from "./bounds";
import type { MeshAlgorithm, MeshDims, MeshResult } from "./generate";
import { polygonizeVolume } from "./polygonize";
import { surfaceNetVolume } from "./surface-net";

interface SerializedSdf {
  dim?: Dim;
  _k?: number | null;
  node: SerializedNode;
}

interface SerializedNode {
  id: number;
  dim: Dim;
  kind: NodeKind;
  params: Record<string, unknown>;
  children: SerializedSdf[];
}

interface GenerateRequest {
  sdf: SerializedSdf;
  bounds: Bounds3;
  dims: MeshDims;
  algorithm: MeshAlgorithm;
  maxTriangles?: number;
}

interface GenerateResponse {
  result?: MeshResult;
  error?: string;
}

self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  try {
    const sdf = reviveSdf(event.data.sdf);
    if (!(sdf instanceof SDF3)) throw new Error("mesh generation requires a 3D SDF");
    const volume = sampleFieldCPU(sdf, event.data.dims, event.data.bounds);
    const polygonizeStart = performance.now();
    const options = { maxTriangles: event.data.maxTriangles };
    const triangles = event.data.algorithm === "surface-net"
      ? surfaceNetVolume(volume, options)
      : polygonizeVolume(volume, options);
    const polygonizeTimeMs = performance.now() - polygonizeStart;
    postMessage({
      result: {
        triangles,
        bounds: event.data.bounds,
        dims: event.data.dims,
        sampleTimeMs: volume.gpuTimeMs,
        polygonizeTimeMs,
        usedGPU: false,
        usedWorker: true,
        algorithm: event.data.algorithm,
      },
    } satisfies GenerateResponse);
  } catch (error) {
    postMessage({
      error: error instanceof Error ? error.message : String(error),
    } satisfies GenerateResponse);
  }
};

function reviveSdf(input: SerializedSdf): SDF {
  const node = reviveNode(input.node);
  const dim = input.dim ?? node.dim;
  const sdf = dim === 2 ? new SDF2(node) : new SDF3(node);
  sdf._k = input._k ?? null;
  return sdf;
}

function reviveNode(input: SerializedNode): Node {
  return {
    id: input.id,
    dim: input.dim,
    kind: input.kind,
    params: input.params,
    children: input.children.map(reviveSdf),
  };
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
