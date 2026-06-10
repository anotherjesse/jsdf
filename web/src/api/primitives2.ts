import { SDF2, intersection, op2 } from "../core/nodes";
import { ORIGIN2, UP2, X2, Y2, asVec, add, mul, normalize, sub } from "../core/math";

export function circle(radius = 1, center: number | ArrayLike<number> = ORIGIN2): SDF2 {
  return op2("circle", { radius, center: asVec(center, 2) });
}

export function line(normal: number | ArrayLike<number> = UP2, point: number | ArrayLike<number> = ORIGIN2): SDF2 {
  return op2("line", { normal: normalize(asVec(normal, 2)), point: asVec(point, 2) });
}

export interface Slab2Options {
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  k?: number | null;
}

export function slab2(options: Slab2Options = {}): SDF2 {
  const fs: SDF2[] = [];
  if (options.x0 != null) fs.push(line(X2, [options.x0, 0]));
  if (options.x1 != null) fs.push(line(mul(X2, -1), [options.x1, 0]));
  if (options.y0 != null) fs.push(line(Y2, [0, options.y0]));
  if (options.y1 != null) fs.push(line(mul(Y2, -1), [0, options.y1]));
  if (fs.length === 0) throw new Error("slab2 requires at least one bound");
  return intersection(fs[0], ...fs.slice(1), { k: options.k ?? null }) as SDF2;
}

export type RectangleArgs = number | ArrayLike<number> | { a: ArrayLike<number>; b: ArrayLike<number> };

export function rectangle(size: RectangleArgs = 1, center: number | ArrayLike<number> = ORIGIN2): SDF2 {
  if (typeof size === "object" && !("length" in size) && "a" in size && "b" in size) {
    const a = asVec(size.a, 2);
    const b = asVec(size.b, 2);
    const s = sub(b, a);
    return rectangle(s, add(a, mul(s, 0.5)));
  }
  return op2("rectangle", { size: asVec(size, 2), center: asVec(center, 2) });
}

export function rounded_rectangle(size: number | ArrayLike<number>, radius: number | ArrayLike<number>, center: number | ArrayLike<number> = ORIGIN2): SDF2 {
  return op2("roundedRectangle", { size: asVec(size, 2), radius: asVec(radius, 4), center: asVec(center, 2) });
}

export function equilateral_triangle(): SDF2 {
  return op2("equilateralTriangle", {});
}

export function hexagon(r: number): SDF2 {
  return op2("hexagon", { r });
}

export function rounded_x(w: number, r: number): SDF2 {
  return op2("roundedX", { w, r });
}

export function polygon(points: Array<ArrayLike<number>>): SDF2 {
  return op2("polygon", { points: points.map((p) => asVec(p, 2)) });
}

export function vesica(r: number, d: number): SDF2 {
  return op2("vesica", { r, d });
}
