import type { VolumeSample } from "../gpu/sampler";

export type Triangle = [number[], number[], number[]];

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

const tetraEdges = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
];

export function polygonizeVolume(volume: VolumeSample): Triangle[] {
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
          );
        }
      }
    }
  }

  return triangles;
}

function polygonizeTet(points: number[][], values: number[], triangles: Triangle[]): void {
  const intersections: number[][] = [];
  for (const [a, b] of tetraEdges) {
    const va = values[a];
    const vb = values[b];
    if ((va < 0 && vb >= 0) || (vb < 0 && va >= 0)) {
      const t = va / (va - vb);
      intersections.push([
        points[a][0] + (points[b][0] - points[a][0]) * t,
        points[a][1] + (points[b][1] - points[a][1]) * t,
        points[a][2] + (points[b][2] - points[a][2]) * t,
      ]);
    }
  }

  if (intersections.length === 3) {
    triangles.push([intersections[0], intersections[1], intersections[2]]);
  } else if (intersections.length === 4) {
    triangles.push([intersections[0], intersections[1], intersections[2]]);
    triangles.push([intersections[0], intersections[2], intersections[3]]);
  }
}

