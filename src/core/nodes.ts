import { ease, easeName, type EaseFn, type EaseName } from "./ease";
import { asColor, type ColorInput } from "./color";
import {
  X,
  Z,
  UP,
  asVec,
  minComponent,
  mul,
  optionalVec,
  rotate2Matrix,
  rotateToMatrix,
  rotationMatrix3,
} from "./math";
import type { MeshOptions, MeshResult } from "../mesh/generate";
import type { SaveOptions, ShowSliceOptions, SliceOptions, SliceSample } from "../workflow";
import {
  generate as generateWorkflow,
  sample_slice as sampleSliceWorkflow,
  save as saveWorkflow,
  show_slice as showSliceWorkflow,
} from "../workflow";

export type Dim = 2 | 3;

export type NodeKind =
  | "circle" | "line" | "rectangle" | "roundedRectangle" | "equilateralTriangle" | "hexagon" | "roundedX" | "polygon" | "vesica"
  | "sphere" | "plane" | "box" | "roundedBox" | "wireframeBox" | "torus" | "capsule" | "cylinder" | "cappedCylinder" | "roundedCylinder"
  | "cappedCone" | "roundedCone" | "ellipsoid" | "pyramid" | "tetrahedron" | "octahedron" | "dodecahedron" | "icosahedron"
  | "name" | "color"
  | "union" | "difference" | "intersection" | "blend" | "negate" | "dilate" | "erode" | "shell" | "repeat"
  | "translate" | "scale" | "rotate2" | "rotate3" | "circularArray2" | "circularArray3" | "elongate2" | "elongate3"
  | "twist" | "bend" | "bendLinear" | "bendRadial" | "transitionLinear" | "transitionRadial" | "wrapAround"
  | "slice" | "extrude" | "extrudeTo" | "revolve";

export interface Node {
  id: number;
  dim: Dim;
  kind: NodeKind;
  params: Record<string, unknown>;
  children: SDF[];
}

export type SDF = SDF2 | SDF3;
export type SDF3Input = SDF3;
export type SDF2Input = SDF2;
export type { ColorInput } from "./color";

let nextNodeId = 1;

export function node(dim: Dim, kind: NodeKind, params: Record<string, unknown> = {}, children: SDF[] = []): Node {
  nextNodeId += 1;
  return { id: nextNodeId, dim, kind, params, children };
}

export function op2(kind: NodeKind, params: Record<string, unknown>, children: SDF[] = []): SDF2 {
  return new SDF2(node(2, kind, params, children));
}

export function op3(kind: NodeKind, params: Record<string, unknown>, children: SDF[] = []): SDF3 {
  return new SDF3(node(3, kind, params, children));
}

export class SDF3 {
  readonly dim = 3 as const;
  _k: number | null = null;

  constructor(readonly node: Node) {}

  k(k: number | null = null): this {
    this._k = k;
    return this;
  }

  union(...args: SDF3OrOptions[]): SDF3 { return union(this, ...args) as SDF3; }
  name(value: string): SDF3 { return name(this, value) as SDF3; }
  color(value: ColorInput): SDF3 { return color(this, value) as SDF3; }
  difference(...args: SDF3OrOptions[]): SDF3 { return difference(this, ...args) as SDF3; }
  subtract(...args: SDF3OrOptions[]): SDF3 { return difference(this, ...args) as SDF3; }
  intersection(...args: SDF3OrOptions[]): SDF3 { return intersection(this, ...args) as SDF3; }
  blend(...args: SDF3OrOptions[]): SDF3 { return blend(this, ...args) as SDF3; }
  negate(): SDF3 { return negate(this) as SDF3; }
  dilate(r: number): SDF3 { return dilate(this, r) as SDF3; }
  erode(r: number): SDF3 { return erode(this, r) as SDF3; }
  shell(thickness: number): SDF3 { return shell(this, thickness) as SDF3; }
  repeat(spacing: number | ArrayLike<number>, count: number | ArrayLike<number> | null = null, padding: number | ArrayLike<number> = 0): SDF3 {
    return repeat(this, spacing, count, padding) as SDF3;
  }

  translate(offset: number | ArrayLike<number>): SDF3 { return op3("translate", { offset: asVec(offset, 3) }, [this]); }
  scale(factor: number | ArrayLike<number>): SDF3 {
    const f = asVec(factor, 3);
    return op3("scale", { factor: f, scaleDistance: minComponent(f) }, [this]);
  }
  rotate(angle: number, vector: number | ArrayLike<number> = Z): SDF3 {
    return op3("rotate3", { matrix: rotationMatrix3(angle, vector) }, [this]);
  }
  rotate_to(a: number | ArrayLike<number>, b: number | ArrayLike<number>): SDF3 { return this.rotateTo(a, b); }
  rotateTo(a: number | ArrayLike<number>, b: number | ArrayLike<number>): SDF3 {
    return op3("rotate3", { matrix: rotateToMatrix(a, b) }, [this]);
  }
  orient(axis: number | ArrayLike<number>): SDF3 { return this.rotateTo(UP, axis); }
  circular_array(count: number, offset = 0): SDF3 { return op3("circularArray3", { count, offset }, [this]); }
  circularArray(count: number, offset = 0): SDF3 { return this.circular_array(count, offset); }
  elongate(size: number | ArrayLike<number>): SDF3 { return op3("elongate3", { size: asVec(size, 3) }, [this]); }
  twist(k: number): SDF3 { return op3("twist", { k }, [this]); }
  bend(k: number): SDF3 { return op3("bend", { k }, [this]); }
  bend_linear(p0: ArrayLike<number>, p1: ArrayLike<number>, v: ArrayLike<number>, e: EaseFn | EaseName = ease.linear): SDF3 {
    return op3("bendLinear", { p0: asVec(p0, 3), p1: asVec(p1, 3), v: mul(asVec(v, 3), -1), ease: easeName(e) }, [this]);
  }
  bendLinear(p0: ArrayLike<number>, p1: ArrayLike<number>, v: ArrayLike<number>, e: EaseFn | EaseName = ease.linear): SDF3 {
    return this.bend_linear(p0, p1, v, e);
  }
  bend_radial(r0: number, r1: number, dz: number, e: EaseFn | EaseName = ease.linear): SDF3 {
    return op3("bendRadial", { r0, r1, dz, ease: easeName(e) }, [this]);
  }
  bendRadial(r0: number, r1: number, dz: number, e: EaseFn | EaseName = ease.linear): SDF3 {
    return this.bend_radial(r0, r1, dz, e);
  }
  transition_linear(other: SDF3, p0: ArrayLike<number> = mul(Z, -1), p1: ArrayLike<number> = Z, e: EaseFn | EaseName = ease.linear): SDF3 {
    return transition_linear(this, other, p0, p1, e);
  }
  transitionLinear(other: SDF3, p0: ArrayLike<number> = mul(Z, -1), p1: ArrayLike<number> = Z, e: EaseFn | EaseName = ease.linear): SDF3 {
    return this.transition_linear(other, p0, p1, e);
  }
  transition_radial(other: SDF3, r0 = 0, r1 = 1, e: EaseFn | EaseName = ease.linear): SDF3 {
    return transition_radial(this, other, r0, r1, e);
  }
  transitionRadial(other: SDF3, r0 = 0, r1 = 1, e: EaseFn | EaseName = ease.linear): SDF3 {
    return this.transition_radial(other, r0, r1, e);
  }
  wrap_around(x0: number, x1: number, r: number | null = null, e: EaseFn | EaseName = ease.linear): SDF3 {
    return op3("wrapAround", { x0, x1, r: r ?? Math.abs(x1 - x0) / (2 * Math.PI), ease: easeName(e) }, [this]);
  }
  wrapAround(x0: number, x1: number, r: number | null = null, e: EaseFn | EaseName = ease.linear): SDF3 {
    return this.wrap_around(x0, x1, r, e);
  }
  slice(): SDF2 { return op2("slice", {}, [this]); }
  async generate(options: MeshOptions = {}): Promise<MeshResult> {
    return generateWorkflow(this, options);
  }
  async save(filename: string, options: SaveOptions = {}): Promise<Blob> {
    return saveWorkflow(filename, this, options);
  }
  sample_slice(options: SliceOptions = {}): SliceSample {
    return sampleSliceWorkflow(this, options);
  }
  show_slice(options: ShowSliceOptions = {}): HTMLCanvasElement {
    return showSliceWorkflow(this, options);
  }
}

export class SDF2 {
  readonly dim = 2 as const;
  _k: number | null = null;

  constructor(readonly node: Node) {}

  k(k: number | null = null): this {
    this._k = k;
    return this;
  }

  union(...args: SDF2OrOptions[]): SDF2 { return union(this, ...args) as SDF2; }
  name(value: string): SDF2 { return name(this, value) as SDF2; }
  color(value: ColorInput): SDF2 { return color(this, value) as SDF2; }
  difference(...args: SDF2OrOptions[]): SDF2 { return difference(this, ...args) as SDF2; }
  subtract(...args: SDF2OrOptions[]): SDF2 { return difference(this, ...args) as SDF2; }
  intersection(...args: SDF2OrOptions[]): SDF2 { return intersection(this, ...args) as SDF2; }
  blend(...args: SDF2OrOptions[]): SDF2 { return blend(this, ...args) as SDF2; }
  negate(): SDF2 { return negate(this) as SDF2; }
  dilate(r: number): SDF2 { return dilate(this, r) as SDF2; }
  erode(r: number): SDF2 { return erode(this, r) as SDF2; }
  shell(thickness: number): SDF2 { return shell(this, thickness) as SDF2; }
  repeat(spacing: number | ArrayLike<number>, count: number | ArrayLike<number> | null = null, padding: number | ArrayLike<number> = 0): SDF2 {
    return repeat(this, spacing, count, padding) as SDF2;
  }

  translate(offset: number | ArrayLike<number>): SDF2 { return op2("translate", { offset: asVec(offset, 2) }, [this]); }
  scale(factor: number | ArrayLike<number>): SDF2 {
    const f = asVec(factor, 2);
    return op2("scale", { factor: f, scaleDistance: minComponent(f) }, [this]);
  }
  rotate(angle: number): SDF2 { return op2("rotate2", { matrix: rotate2Matrix(angle) }, [this]); }
  circular_array(count: number): SDF2 { return op2("circularArray2", { count }, [this]); }
  circularArray(count: number): SDF2 { return this.circular_array(count); }
  elongate(size: number | ArrayLike<number>): SDF2 { return op2("elongate2", { size: asVec(size, 2) }, [this]); }
  extrude(h: number): SDF3 { return op3("extrude", { h }, [this]); }
  extrude_to(other: SDF2, h: number, e: EaseFn | EaseName = ease.linear): SDF3 { return extrude_to(this, other, h, e); }
  extrudeTo(other: SDF2, h: number, e: EaseFn | EaseName = ease.linear): SDF3 { return this.extrude_to(other, h, e); }
  revolve(offset = 0): SDF3 { return op3("revolve", { offset }, [this]); }
}

type OpOptions = { k?: number | null };
type SDF3OrOptions = SDF3 | OpOptions;
type SDF2OrOptions = SDF2 | OpOptions;

function isSDF(value: unknown): value is SDF {
  return value instanceof SDF2 || value instanceof SDF3;
}

function splitOptions(args: (SDF | OpOptions)[]): [OpOptions, SDF[]] {
  const last = args.at(-1);
  if (last && !isSDF(last)) return [last, args.slice(0, -1) as SDF[]];
  return [{}, args as SDF[]];
}

function all(first: SDF, rest: (SDF | OpOptions)[]): [OpOptions, SDF[]] {
  const [options, operands] = splitOptions(rest);
  const children = [first, ...operands];
  const dim = children[0].dim;
  if (!children.every((child) => child.dim === dim)) throw new Error("all SDF operands must have the same dimension");
  return [options, children];
}

function entries(children: SDF[], fallback: number | null): { k: number | null }[] {
  return children.map((child, index) => ({ k: index === 0 ? null : child._k ?? fallback }));
}

function common(kind: NodeKind, first: SDF, rest: (SDF | OpOptions)[], fallback: number | null): SDF {
  const [options, children] = all(first, rest);
  const params = { entries: entries(children, options.k ?? fallback), k: options.k ?? fallback };
  return children[0].dim === 2 ? op2(kind, params, children) : op3(kind, params, children);
}

export function union(first: SDF, ...rest: (SDF | OpOptions)[]): SDF {
  return common("union", first, rest, null);
}

export function name(other: SDF, value: string): SDF {
  const label = String(value);
  return other.dim === 2 ? op2("name", { name: label }, [other]) : op3("name", { name: label }, [other]);
}

export function color(other: SDF, value: ColorInput): SDF {
  const parsed = asColor(value);
  return other.dim === 2 ? op2("color", { color: parsed }, [other]) : op3("color", { color: parsed }, [other]);
}

export function difference(first: SDF, ...rest: (SDF | OpOptions)[]): SDF {
  return common("difference", first, rest, null);
}

export function intersection(first: SDF, ...rest: (SDF | OpOptions)[]): SDF {
  return common("intersection", first, rest, null);
}

export function blend(first: SDF, ...rest: (SDF | OpOptions)[]): SDF {
  return common("blend", first, rest, 0.5);
}

export function negate(other: SDF): SDF {
  return other.dim === 2 ? op2("negate", {}, [other]) : op3("negate", {}, [other]);
}

export function dilate(other: SDF, r: number): SDF {
  return other.dim === 2 ? op2("dilate", { r }, [other]) : op3("dilate", { r }, [other]);
}

export function erode(other: SDF, r: number): SDF {
  return other.dim === 2 ? op2("erode", { r }, [other]) : op3("erode", { r }, [other]);
}

export function shell(other: SDF, thickness: number): SDF {
  return other.dim === 2 ? op2("shell", { thickness }, [other]) : op3("shell", { thickness }, [other]);
}

export function repeat(other: SDF, spacing: number | ArrayLike<number>, count: number | ArrayLike<number> | null = null, padding: number | ArrayLike<number> = 0): SDF {
  const s = asVec(spacing, other.dim);
  const p = asVec(padding, other.dim).map((v, i) => s[i] === 0 ? 0 : Math.max(0, Math.floor(v)));
  const params = { spacing: s, count: optionalVec(count, other.dim), padding: p };
  return other.dim === 2 ? op2("repeat", params, [other]) : op3("repeat", params, [other]);
}

export function transition_linear(f0: SDF3, f1: SDF3, p0: ArrayLike<number> = mul(Z, -1), p1: ArrayLike<number> = Z, e: EaseFn | EaseName = ease.linear): SDF3 {
  return op3("transitionLinear", { p0: asVec(p0, 3), p1: asVec(p1, 3), ease: easeName(e) }, [f0, f1]);
}

export function transition_radial(f0: SDF3, f1: SDF3, r0 = 0, r1 = 1, e: EaseFn | EaseName = ease.linear): SDF3 {
  return op3("transitionRadial", { r0, r1, ease: easeName(e) }, [f0, f1]);
}

export function extrude_to(a: SDF2, b: SDF2, h: number, e: EaseFn | EaseName = ease.linear): SDF3 {
  return op3("extrudeTo", { h, ease: easeName(e) }, [a, b]);
}

export function repeatOffsets(padding: readonly number[]): number[][] {
  const axes = padding.map((p) => Array.from({ length: p * 2 + 1 }, (_, i) => i - p));
  const out: number[][] = [];
  function walk(i: number, acc: number[]): void {
    if (i === axes.length) {
      out.push([...acc]);
      return;
    }
    for (const v of axes[i]) {
      acc.push(v);
      walk(i + 1, acc);
      acc.pop();
    }
  }
  walk(0, []);
  return out;
}
