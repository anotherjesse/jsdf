import type { VolumeSample } from "../gpu/sampler";
import type { Triangle } from "./polygonize";

const cornerOffsets = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

const cubeEdges = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export function surfaceNetVolume(volume: VolumeSample): Triangle[] {
  const { values, dims, bounds, step } = volume;
  const [nx, ny, nz] = dims;
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const vertices = new Array<number[] | null>(cx * cy * cz).fill(null);
  const cubeValues = new Array<number>(8);

  const sampleIndex = (x: number, y: number, z: number) => x + y * nx + z * nx * ny;
  const cellIndex = (x: number, y: number, z: number) => x + y * cx + z * cx * cy;

  for (let z = 0; z < cz; z += 1) {
    for (let y = 0; y < cy; y += 1) {
      for (let x = 0; x < cx; x += 1) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < 8; i += 1) {
          const o = cornerOffsets[i];
          const value = values[sampleIndex(x + o[0], y + o[1], z + o[2])];
          cubeValues[i] = value;
          lo = Math.min(lo, value);
          hi = Math.max(hi, value);
        }
        if (lo >= 0 || hi < 0) continue;

        const point = [0, 0, 0];
        let crossings = 0;
        for (const [a, b] of cubeEdges) {
          const va = cubeValues[a];
          const vb = cubeValues[b];
          if ((va < 0) === (vb < 0)) continue;
          const oa = cornerOffsets[a];
          const ob = cornerOffsets[b];
          const t = Math.abs(va - vb) < 1e-12 ? 0.5 : va / (va - vb);
          point[0] += bounds[0][0] + (x + oa[0] + (ob[0] - oa[0]) * t) * step[0];
          point[1] += bounds[0][1] + (y + oa[1] + (ob[1] - oa[1]) * t) * step[1];
          point[2] += bounds[0][2] + (z + oa[2] + (ob[2] - oa[2]) * t) * step[2];
          crossings += 1;
        }

        if (crossings > 0) {
          vertices[cellIndex(x, y, z)] = point.map((value) => value / crossings);
        }
      }
    }
  }

  const triangles: Triangle[] = [];
  const vertex = (x: number, y: number, z: number) => vertices[cellIndex(x, y, z)];

  for (let z = 1; z < nz - 1; z += 1) {
    for (let y = 1; y < ny - 1; y += 1) {
      for (let x = 0; x < nx - 1; x += 1) {
        if (sameSign(values[sampleIndex(x, y, z)], values[sampleIndex(x + 1, y, z)])) continue;
        addQuad(
          vertex(x, y - 1, z - 1),
          vertex(x, y, z - 1),
          vertex(x, y, z),
          vertex(x, y - 1, z),
          edgeGradient(volume, x, y, z),
          triangles,
        );
      }
    }
  }

  for (let z = 1; z < nz - 1; z += 1) {
    for (let y = 0; y < ny - 1; y += 1) {
      for (let x = 1; x < nx - 1; x += 1) {
        if (sameSign(values[sampleIndex(x, y, z)], values[sampleIndex(x, y + 1, z)])) continue;
        addQuad(
          vertex(x - 1, y, z - 1),
          vertex(x, y, z - 1),
          vertex(x, y, z),
          vertex(x - 1, y, z),
          edgeGradient(volume, x, y, z),
          triangles,
        );
      }
    }
  }

  for (let z = 0; z < nz - 1; z += 1) {
    for (let y = 1; y < ny - 1; y += 1) {
      for (let x = 1; x < nx - 1; x += 1) {
        if (sameSign(values[sampleIndex(x, y, z)], values[sampleIndex(x, y, z + 1)])) continue;
        addQuad(
          vertex(x - 1, y - 1, z),
          vertex(x, y - 1, z),
          vertex(x, y, z),
          vertex(x - 1, y, z),
          edgeGradient(volume, x, y, z),
          triangles,
        );
      }
    }
  }

  return triangles;
}

function sameSign(a: number, b: number): boolean {
  return (a < 0) === (b < 0);
}

function addQuad(
  a: number[] | null,
  b: number[] | null,
  c: number[] | null,
  d: number[] | null,
  gradient: number[],
  triangles: Triangle[],
): void {
  if (!a || !b || !c || !d) return;
  triangles.push(orientTriangle([a, b, c], gradient));
  triangles.push(orientTriangle([a, c, d], gradient));
}

function edgeGradient(volume: VolumeSample, x: number, y: number, z: number): number[] {
  const { values, dims, step } = volume;
  const [nx, ny, nz] = dims;
  const sample = (ix: number, iy: number, iz: number) => {
    const xx = clampIndex(ix, nx);
    const yy = clampIndex(iy, ny);
    const zz = clampIndex(iz, nz);
    return values[xx + yy * nx + zz * nx * ny];
  };
  return [
    (sample(x + 1, y, z) - sample(x - 1, y, z)) / (2 * step[0]),
    (sample(x, y + 1, z) - sample(x, y - 1, z)) / (2 * step[1]),
    (sample(x, y, z + 1) - sample(x, y, z - 1)) / (2 * step[2]),
  ];
}

function clampIndex(value: number, size: number): number {
  return Math.min(Math.max(value, 0), size - 1);
}

function orientTriangle(triangle: Triangle, gradient: number[]): Triangle {
  const normal = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]));
  return dot(normal, gradient) < 0 ? [triangle[0], triangle[2], triangle[1]] : triangle;
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
