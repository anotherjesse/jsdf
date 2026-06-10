export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];
export type Vec = readonly number[];

export const PI = Math.PI;
export const ORIGIN2: Vec2 = [0, 0];
export const ORIGIN: Vec3 = [0, 0, 0];
export const X2: Vec2 = [1, 0];
export const Y2: Vec2 = [0, 1];
export const X: Vec3 = [1, 0, 0];
export const Y: Vec3 = [0, 1, 0];
export const Z: Vec3 = [0, 0, 1];
export const UP2 = Y2;
export const UP = Z;

export function degrees(radians: number): number {
  return radians * 180 / Math.PI;
}

export function radians(degreesValue: number): number {
  return degreesValue * Math.PI / 180;
}

export function asVec(value: number | ArrayLike<number> | undefined, dim: number, fallback = 0): number[] {
  if (value == null) return Array.from({ length: dim }, () => fallback);
  if (typeof value === "number") return Array.from({ length: dim }, () => value);
  const out = Array.from(value).slice(0, dim).map(Number);
  while (out.length < dim) out.push(fallback);
  return out;
}

export function optionalVec(value: number | ArrayLike<number> | null | undefined, dim: number): number[] | null {
  return value == null ? null : asVec(value, dim);
}

export function add(a: Vec, b: Vec): number[] {
  return a.map((v, i) => v + b[i]);
}

export function sub(a: Vec, b: Vec): number[] {
  return a.map((v, i) => v - b[i]);
}

export function mul(a: Vec, b: Vec | number): number[] {
  return typeof b === "number" ? a.map((v) => v * b) : a.map((v, i) => v * b[i]);
}

export function div(a: Vec, b: Vec | number): number[] {
  return typeof b === "number"
    ? a.map((v) => (b === 0 ? 0 : v / b))
    : a.map((v, i) => (b[i] === 0 ? 0 : v / b[i]));
}

export function abs(a: Vec): number[] {
  return a.map(Math.abs);
}

export function maxVec(a: Vec, b: Vec | number): number[] {
  return typeof b === "number" ? a.map((v) => Math.max(v, b)) : a.map((v, i) => Math.max(v, b[i]));
}

export function dot(a: Vec, b: Vec): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

export function length(a: Vec): number {
  return Math.sqrt(dot(a, a));
}

export function normalize<T extends Vec>(a: T): number[] {
  const l = length(a);
  if (l === 0) throw new Error("zero vector");
  return a.map((v) => v / l);
}

export function cross(a: Vec3 | number[], b: Vec3 | number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

export function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function maxComponent(a: Vec): number {
  return a.reduce((m, v) => Math.max(m, v), -Infinity);
}

export function minComponent(a: Vec): number {
  return a.reduce((m, v) => Math.min(m, v), Infinity);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function rotate2Matrix(angle: number): number[][] {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return [[c, -s], [s, c]];
}

export function mulMat2Point(matrix: number[][], p: Vec): number[] {
  return [
    p[0] * matrix[0][0] + p[1] * matrix[1][0],
    p[0] * matrix[0][1] + p[1] * matrix[1][1],
  ];
}

export function rotationMatrix3(angle: number, vector: number | ArrayLike<number> = Z): number[][] {
  const [x, y, z] = normalize(asVec(vector, 3));
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const m = 1 - c;
  return [
    [m * x * x + c, m * x * y + z * s, m * z * x - y * s],
    [m * x * y - z * s, m * y * y + c, m * y * z + x * s],
    [m * z * x + y * s, m * y * z - x * s, m * z * z + c],
  ];
}

export function mulMat3Point(matrix: number[][], p: Vec): number[] {
  return [
    p[0] * matrix[0][0] + p[1] * matrix[1][0] + p[2] * matrix[2][0],
    p[0] * matrix[0][1] + p[1] * matrix[1][1] + p[2] * matrix[2][1],
    p[0] * matrix[0][2] + p[1] * matrix[1][2] + p[2] * matrix[2][2],
  ];
}

function perpendicular(v: number[]): number[] {
  if (v[1] === 0 && v[2] === 0) {
    if (v[0] === 0) throw new Error("zero vector");
    return cross(v, [0, 1, 0]);
  }
  return cross(v, [1, 0, 0]);
}

export function rotateToMatrix(a: number | ArrayLike<number>, b: number | ArrayLike<number>): number[][] {
  const aa = normalize(asVec(a, 3));
  const bb = normalize(asVec(b, 3));
  const d = dot(bb, aa);
  if (Math.abs(d - 1) < 1e-12) return rotationMatrix3(0, Z);
  if (Math.abs(d + 1) < 1e-12) return rotationMatrix3(Math.PI, perpendicular(aa));
  return rotationMatrix3(Math.acos(clamp(d, -1, 1)), normalize(cross(bb, aa)));
}

