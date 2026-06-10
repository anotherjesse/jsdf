import { sphere } from "../api";
import { binarySTL, generateMesh, type MeshAlgorithm } from "../mesh/generate";

export interface MeshRuntimeVerification {
  ok: boolean;
  grid: number;
  results: MeshAlgorithmResult[];
  fallback: MeshAlgorithmResult;
  errors: string[];
}

export interface MeshAlgorithmResult {
  algorithm: MeshAlgorithm;
  triangles: number;
  stlBytes: number;
  expectedStlBytes: number;
  stlTriangleCount: number;
  usedGPU: boolean;
  usedWorker: boolean;
  sampleTimeMs: number;
  polygonizeTimeMs: number;
  totalTimeMs: number;
  bounds: [number[], number[]];
}

const bounds: [number[], number[]] = [[-1.35, -1.35, -1.35], [1.35, 1.35, 1.35]];
const grid = 32;

export async function runMeshRuntimeVerification(): Promise<MeshRuntimeVerification> {
  const errors: string[] = [];
  const sdf = sphere(1);
  const results: MeshAlgorithmResult[] = [];

  for (const algorithm of ["surface-net", "tetra"] as MeshAlgorithm[]) {
    const start = performance.now();
    const mesh = algorithm === "surface-net"
      ? await sdf.generate({ algorithm, bounds, grid, preferGPU: true, preferWorker: true })
      : await generateMesh(sdf, { algorithm, bounds, grid, preferGPU: true, preferWorker: true });
    const result = await summarizeMesh(algorithm, mesh, performance.now() - start);
    results.push(result);
    verifyMeshResult(result, errors, { requireWorker: true });
    verifyFiniteTriangles(mesh.triangles, algorithm, errors);
  }

  const fallbackStart = performance.now();
  const fallbackMesh = await generateMesh(sdf, {
    algorithm: "surface-net",
    bounds,
    grid: 18,
    preferGPU: false,
    preferWorker: false,
  });
  const fallback = await summarizeMesh("surface-net", fallbackMesh, performance.now() - fallbackStart);
  verifyMeshResult(fallback, errors, { requireWorker: false });
  if (fallback.usedGPU) errors.push("CPU fallback unexpectedly used WebGPU");
  if (fallback.usedWorker) errors.push("synchronous fallback unexpectedly used worker");
  verifyFiniteTriangles(fallbackMesh.triangles, "surface-net fallback", errors);

  const surface = results.find((result) => result.algorithm === "surface-net");
  const tetra = results.find((result) => result.algorithm === "tetra");
  if (surface && tetra && surface.triangles >= tetra.triangles) {
    errors.push(`surface-net should be leaner than tetra on sphere fixture (${surface.triangles} >= ${tetra.triangles})`);
  }

  return {
    ok: errors.length === 0,
    grid,
    results,
    fallback,
    errors,
  };
}

async function summarizeMesh(algorithm: MeshAlgorithm, mesh: Awaited<ReturnType<typeof generateMesh>>, totalTimeMs: number): Promise<MeshAlgorithmResult> {
  const stl = binarySTL(mesh.triangles, `sdf-browser check ${algorithm}`);
  const stlBuffer = await stl.arrayBuffer();
  return {
    algorithm,
    triangles: mesh.triangles.length,
    stlBytes: stl.size,
    expectedStlBytes: 84 + mesh.triangles.length * 50,
    stlTriangleCount: new DataView(stlBuffer).getUint32(80, true),
    usedGPU: mesh.usedGPU,
    usedWorker: mesh.usedWorker,
    sampleTimeMs: mesh.sampleTimeMs,
    polygonizeTimeMs: mesh.polygonizeTimeMs,
    totalTimeMs,
    bounds: mesh.bounds,
  };
}

function verifyMeshResult(result: MeshAlgorithmResult, errors: string[], options: { requireWorker: boolean }): void {
  if (result.triangles <= 0) errors.push(`${result.algorithm} generated no triangles`);
  if (result.stlBytes !== result.expectedStlBytes) {
    errors.push(`${result.algorithm} STL size mismatch: ${result.stlBytes} !== ${result.expectedStlBytes}`);
  }
  if (result.stlTriangleCount !== result.triangles) {
    errors.push(`${result.algorithm} STL triangle count mismatch: ${result.stlTriangleCount} !== ${result.triangles}`);
  }
  if (options.requireWorker && !result.usedWorker) errors.push(`${result.algorithm} did not use worker polygonization`);
}

function verifyFiniteTriangles(
  triangles: Awaited<ReturnType<typeof generateMesh>>["triangles"],
  label: string,
  errors: string[],
): void {
  let degenerate = 0;
  for (const [triIndex, triangle] of triangles.entries()) {
    for (const [pointIndex, point] of triangle.entries()) {
      for (const value of point) {
        if (!Number.isFinite(value)) {
          errors.push(`${label} triangle ${triIndex} point ${pointIndex} has non-finite coordinate ${value}`);
          return;
        }
      }
    }
    if (area2(triangle) < 1e-12) degenerate += 1;
  }
  if (degenerate > 0) errors.push(`${label} generated ${degenerate} degenerate triangles`);
}

function area2(triangle: [number[], number[], number[]]): number {
  const [a, b, c] = triangle;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.hypot(nx, ny, nz);
}
