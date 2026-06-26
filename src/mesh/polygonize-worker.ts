import type { VolumeSample } from "../gpu/sampler";
import type { MeshAlgorithm } from "./generate";
import { polygonizeVolume, type Triangle } from "./polygonize";
import { surfaceNetVolume } from "./surface-net";

interface PolygonizeRequest {
  algorithm: MeshAlgorithm;
  values: ArrayBuffer;
  dims: [number, number, number];
  bounds: [number[], number[]];
  step: [number, number, number];
  maxTriangles?: number;
}

interface PolygonizeResponse {
  triangles?: Triangle[];
  polygonizeTimeMs?: number;
  error?: string;
}

self.onmessage = (event: MessageEvent<PolygonizeRequest>) => {
  const start = performance.now();
  try {
    const volume: VolumeSample = {
      values: new Float32Array(event.data.values),
      dims: event.data.dims,
      bounds: event.data.bounds,
      step: event.data.step,
      gpuTimeMs: 0,
    };
    const options = { maxTriangles: event.data.maxTriangles };
    const triangles = event.data.algorithm === "surface-net" ? surfaceNetVolume(volume, options) : polygonizeVolume(volume, options);
    postMessage({ triangles, polygonizeTimeMs: performance.now() - start } satisfies PolygonizeResponse);
  } catch (error) {
    postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies PolygonizeResponse);
  }
};
