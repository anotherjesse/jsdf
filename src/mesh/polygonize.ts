import type { VolumeSample } from "../gpu/sampler";

export type Triangle = [number[], number[], number[]];
export interface PolygonizeOptions {
  maxTriangles?: number;
}

export const TRIANGLE_LIMIT_ERROR_PREFIX = "Mesh generated more than";

export function enforceTriangleLimit(triangles: Triangle[], maxTriangles?: number): void {
  if (maxTriangles == null || maxTriangles <= 0 || triangles.length <= maxTriangles) return;
  throw new Error(`${TRIANGLE_LIMIT_ERROR_PREFIX} ${maxTriangles.toLocaleString()} triangles. Lower the mesh grid, reduce repeated detail, or switch mesh style.`);
}

export function isTriangleLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith(TRIANGLE_LIMIT_ERROR_PREFIX);
}

const cornerOffsets = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

const tetrahedra = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
];

export function polygonizeVolume(volume: VolumeSample, options: PolygonizeOptions = {}): Triangle[] {
  const { values, dims, bounds, step } = volume;
  const [nx, ny, nz] = dims;
  const triangles: Triangle[] = [];
  const cubePoints = Array.from({ length: 8 }, () => [0, 0, 0]);
  const cubeValues = new Array<number>(8);

  const index = (x: number, y: number, z: number) => x + y * nx + z * nx * ny;
  for (let z = 0; z < nz - 1; z += 1) {
    for (let y = 0; y < ny - 1; y += 1) {
      for (let x = 0; x < nx - 1; x += 1) {
        for (let i = 0; i < 8; i += 1) {
          const o = cornerOffsets[i];
          cubePoints[i] = [
            bounds[0][0] + (x + o[0]) * step[0],
            bounds[0][1] + (y + o[1]) * step[1],
            bounds[0][2] + (z + o[2]) * step[2],
          ];
          cubeValues[i] = values[index(x + o[0], y + o[1], z + o[2])];
        }

        for (const tet of tetrahedra) {
          polygonizeTet(
            tet.map((i) => cubePoints[i]),
            tet.map((i) => cubeValues[i]),
            triangles,
            options.maxTriangles,
          );
        }
      }
    }
  }

  return triangles;
}

function polygonizeTet(points: number[][], values: number[], triangles: Triangle[], maxTriangles?: number): void {
  const inside: number[] = [];
  const outside: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    if (values[i] < 0) inside.push(i);
    else outside.push(i);
  }

  if (inside.length === 0 || inside.length === 4) return;

  const gradient = tetraGradient(points, values);

  if (inside.length === 1) {
    const i = inside[0];
    const tri = [
      interpolate(points, values, i, outside[0]),
      interpolate(points, values, i, outside[1]),
      interpolate(points, values, i, outside[2]),
    ] as Triangle;
    triangles.push(orientTriangle(tri, gradient));
    enforceTriangleLimit(triangles, maxTriangles);
  } else if (inside.length === 3) {
    const o = outside[0];
    const tri = [
      interpolate(points, values, o, inside[0]),
      interpolate(points, values, o, inside[2]),
      interpolate(points, values, o, inside[1]),
    ] as Triangle;
    triangles.push(orientTriangle(tri, gradient));
    enforceTriangleLimit(triangles, maxTriangles);
  } else {
    const [i0, i1] = inside;
    const [o0, o1] = outside;
    const a = interpolate(points, values, i0, o0);
    const b = interpolate(points, values, i0, o1);
    const c = interpolate(points, values, i1, o0);
    const d = interpolate(points, values, i1, o1);
    triangles.push(orientTriangle([a, c, d], gradient));
    triangles.push(orientTriangle([a, d, b], gradient));
    enforceTriangleLimit(triangles, maxTriangles);
  }
}

function interpolate(points: number[][], values: number[], a: number, b: number): number[] {
  const va = values[a];
  const vb = values[b];
  const t = Math.abs(va - vb) < 1e-12 ? 0.5 : va / (va - vb);
  return [
    points[a][0] + (points[b][0] - points[a][0]) * t,
    points[a][1] + (points[b][1] - points[a][1]) * t,
    points[a][2] + (points[b][2] - points[a][2]) * t,
  ];
}

function orientTriangle(triangle: Triangle, gradient: number[]): Triangle {
  const normal = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]));
  return dot(normal, gradient) < 0 ? [triangle[0], triangle[2], triangle[1]] : triangle;
}

function tetraGradient(points: number[][], values: number[]): number[] {
  const a = [
    sub(points[1], points[0]),
    sub(points[2], points[0]),
    sub(points[3], points[0]),
  ];
  const b = [
    values[1] - values[0],
    values[2] - values[0],
    values[3] - values[0],
  ];
  return solve3(a, b) ?? [0, 0, 1];
}

function solve3(a: number[][], b: number[]): number[] | null {
  const det =
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  if (Math.abs(det) < 1e-12) return null;

  const dx =
    b[0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (b[1] * a[2][2] - a[1][2] * b[2]) +
    a[0][2] * (b[1] * a[2][1] - a[1][1] * b[2]);
  const dy =
    a[0][0] * (b[1] * a[2][2] - a[1][2] * b[2]) -
    b[0] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * b[2] - b[1] * a[2][0]);
  const dz =
    a[0][0] * (a[1][1] * b[2] - b[1] * a[2][1]) -
    a[0][1] * (a[1][0] * b[2] - b[1] * a[2][0]) +
    b[0] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);

  return [dx / det, dy / det, dz / det];
}

function sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
