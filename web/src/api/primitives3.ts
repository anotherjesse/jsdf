import { ease, type EaseFn, type EaseName } from "../core/ease";
import { SDF3, intersection, op3 } from "../core/nodes";
import { ORIGIN, UP, X, Y, Z, asVec, add, mul, normalize, sub } from "../core/math";

export function sphere(radius = 1, center: number | ArrayLike<number> = ORIGIN): SDF3 {
  return op3("sphere", { radius, center: asVec(center, 3) });
}

export function plane(normal: number | ArrayLike<number> = UP, point: number | ArrayLike<number> = ORIGIN): SDF3 {
  return op3("plane", { normal: normalize(asVec(normal, 3)), point: asVec(point, 3) });
}

export interface Slab3Options {
  x0?: number;
  y0?: number;
  z0?: number;
  x1?: number;
  y1?: number;
  z1?: number;
  k?: number | null;
}

export function slab(options: Slab3Options = {}): SDF3 {
  const fs: SDF3[] = [];
  if (options.x0 != null) fs.push(plane(X, [options.x0, 0, 0]));
  if (options.x1 != null) fs.push(plane(mul(X, -1), [options.x1, 0, 0]));
  if (options.y0 != null) fs.push(plane(Y, [0, options.y0, 0]));
  if (options.y1 != null) fs.push(plane(mul(Y, -1), [0, options.y1, 0]));
  if (options.z0 != null) fs.push(plane(Z, [0, 0, options.z0]));
  if (options.z1 != null) fs.push(plane(mul(Z, -1), [0, 0, options.z1]));
  if (fs.length === 0) throw new Error("slab requires at least one bound");
  return intersection(fs[0], ...fs.slice(1), { k: options.k ?? null }) as SDF3;
}

export type BoxArgs = number | ArrayLike<number> | { a: ArrayLike<number>; b: ArrayLike<number> };

export function box(size: BoxArgs = 1, center: number | ArrayLike<number> = ORIGIN): SDF3 {
  if (typeof size === "object" && !("length" in size) && "a" in size && "b" in size) {
    const a = asVec(size.a, 3);
    const b = asVec(size.b, 3);
    const s = sub(b, a);
    return box(s, add(a, mul(s, 0.5)));
  }
  return op3("box", { size: asVec(size, 3), center: asVec(center, 3) });
}

export function rounded_box(size: number | ArrayLike<number>, radius: number): SDF3 {
  return op3("roundedBox", { size: asVec(size, 3), radius });
}

export function wireframe_box(size: number | ArrayLike<number>, thickness: number): SDF3 {
  return op3("wireframeBox", { size: asVec(size, 3), thickness });
}

export function torus(r1: number, r2: number): SDF3 {
  return op3("torus", { r1, r2 });
}

export function capsule(a: ArrayLike<number>, b: ArrayLike<number>, radius: number): SDF3 {
  return op3("capsule", { a: asVec(a, 3), b: asVec(b, 3), radius });
}

export function cylinder(radius: number): SDF3 {
  return op3("cylinder", { radius });
}

export function capped_cylinder(a: ArrayLike<number>, b: ArrayLike<number>, radius: number): SDF3 {
  return op3("cappedCylinder", { a: asVec(a, 3), b: asVec(b, 3), radius });
}

export function rounded_cylinder(ra: number, rb: number, h: number): SDF3 {
  return op3("roundedCylinder", { ra, rb, h });
}

export function capped_cone(a: ArrayLike<number>, b: ArrayLike<number>, ra: number, rb: number): SDF3 {
  return op3("cappedCone", { a: asVec(a, 3), b: asVec(b, 3), ra, rb });
}

export function rounded_cone(r1: number, r2: number, h: number): SDF3 {
  return op3("roundedCone", { r1, r2, h });
}

export function ellipsoid(size: number | ArrayLike<number>): SDF3 {
  return op3("ellipsoid", { size: asVec(size, 3) });
}

export function pyramid(h: number): SDF3 {
  return op3("pyramid", { h });
}

export function tetrahedron(r: number): SDF3 {
  return op3("tetrahedron", { r });
}

export function octahedron(r: number): SDF3 {
  return op3("octahedron", { r });
}

export function dodecahedron(r: number): SDF3 {
  return op3("dodecahedron", { r });
}

export function icosahedron(r: number): SDF3 {
  return op3("icosahedron", { r });
}

export { ease };
export type { EaseFn, EaseName };

