import { easeParam } from "../evaluate/common";
import { eval2Node } from "../evaluate/evaluate2";
import { eval3Node } from "../evaluate/evaluate3";
import {
  add,
  clamp,
  dot,
  maxVec,
  mix,
  modulo,
  mul,
  mulMat2Point,
  mulMat3Point,
  sub,
} from "../core/math";
import { asColor, colorToHex, type ColorInput } from "../core/color";
import {
  repeatOffsets,
  SDF3,
  type Node,
} from "../core/nodes";

export const DEFAULT_ANNOTATION_COLOR = [0.14, 0.70, 0.65] as const;

export interface ResolvedAnnotation {
  distance: number;
  name: string | null;
  color: [number, number, number];
  colorHex: string;
  ambiguous: boolean;
  ownerNodeId: number | null;
  nameNodeId: number | null;
  colorNodeId: number | null;
}

export interface AnnotationResolveOptions {
  colorsByName?: Record<string, ColorInput>;
  defaultColor?: ColorInput;
  ambiguityEpsilon?: number;
}

interface PartialAnnotation {
  distance: number;
  name: string | null;
  color: [number, number, number] | null;
  ambiguous: boolean;
  ownerNodeId: number | null;
  nameNodeId: number | null;
  colorNodeId: number | null;
}

interface ResolveContext {
  name: string | null;
  color: [number, number, number] | null;
  nameNodeId: number | null;
  colorNodeId: number | null;
}

export function createAnnotationResolver3(sdf: SDF3 | Node, options: AnnotationResolveOptions = {}): (point: ArrayLike<number>) => ResolvedAnnotation {
  const root = sdf instanceof SDF3 ? sdf.node : sdf;
  if (root.dim !== 3) throw new Error("annotation resolver requires a 3D SDF node");
  const colorsByName = new Map<string, [number, number, number]>();
  for (const [name, color] of Object.entries(options.colorsByName ?? {})) {
    colorsByName.set(name, asColor(color));
  }
  const defaultColor = asColor(options.defaultColor ?? DEFAULT_ANNOTATION_COLOR);
  const ambiguityEpsilon = options.ambiguityEpsilon ?? 1e-5;

  return (point) => {
    const resolved = resolveNode(root, Array.from(point).slice(0, 3), emptyContext(), ambiguityEpsilon);
    const color = resolved.name && colorsByName.has(resolved.name)
      ? colorsByName.get(resolved.name)!
      : resolved.color ?? defaultColor;
    return {
      distance: resolved.distance,
      name: resolved.name,
      color,
      colorHex: colorToHex(color),
      ambiguous: resolved.ambiguous,
      ownerNodeId: resolved.ownerNodeId,
      nameNodeId: resolved.nameNodeId,
      colorNodeId: resolved.colorNodeId,
    };
  };
}

export function resolveAnnotation3(sdf: SDF3 | Node, point: ArrayLike<number>, options: AnnotationResolveOptions = {}): ResolvedAnnotation {
  return createAnnotationResolver3(sdf, options)(point);
}

export function collectAnnotationNames(root: Node): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Set<number>();
  const visit = (node: Node): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (node.kind === "name") {
      const label = String(node.params.name ?? "");
      out.set(label, (out.get(label) ?? 0) + 1);
    }
    for (const child of node.children) visit(child.node);
  };
  visit(root);
  return out;
}

function emptyContext(): ResolveContext {
  return { name: null, color: null, nameNodeId: null, colorNodeId: null };
}

function resolveNode(node: Node, point: number[], context: ResolveContext, ambiguityEpsilon: number): PartialAnnotation {
  const children = node.children.map((child) => child.node);
  const par = node.params as Record<string, unknown>;

  switch (node.kind) {
    case "name": {
      const child = resolveNode(children[0], point, context, ambiguityEpsilon);
      return {
        ...child,
        name: String(par.name ?? ""),
        nameNodeId: node.id,
      };
    }
    case "color": {
      const child = resolveNode(children[0], point, context, ambiguityEpsilon);
      return {
        ...child,
        color: asColor(par.color as number[]),
        colorNodeId: node.id,
      };
    }
    case "union":
      return resolveExtremum(node, point, context, ambiguityEpsilon, "min");
    case "intersection":
      return resolveExtremum(node, point, context, ambiguityEpsilon, "max");
    case "difference": {
      const base = resolveNode(children[0], point, context, ambiguityEpsilon);
      let ambiguous = base.ambiguous;
      for (let i = 1; i < children.length; i += 1) {
        const cutter = resolveNode(children[i], point, context, ambiguityEpsilon);
        ambiguous = ambiguous || cutter.ambiguous || Math.abs(base.distance + cutter.distance) <= ambiguityEpsilon;
      }
      return withDistance(base, evaluateNode(node, point), ambiguous);
    }
    case "blend": {
      const params = par as { entries?: Array<{ k: number | null }>; k?: number | null };
      let selected = resolveNode(children[0], point, context, ambiguityEpsilon);
      let ambiguous = selected.ambiguous;
      for (let i = 1; i < children.length; i += 1) {
        const next = resolveNode(children[i], point, context, ambiguityEpsilon);
        const k = params.entries?.[i]?.k ?? params.k ?? 0.5;
        ambiguous = ambiguous || next.ambiguous || Math.abs(k - 0.5) <= 0.05;
        if (k >= 0.5) selected = next;
      }
      return withDistance(selected, evaluateNode(node, point), ambiguous);
    }
    case "negate":
    case "dilate":
    case "erode":
    case "shell":
      return withDistance(resolveNode(children[0], point, context, ambiguityEpsilon), evaluateNode(node, point));
    case "repeat":
      return resolveRepeat(node, point, context, ambiguityEpsilon);
    case "translate":
      return withDistance(resolveNode(children[0], sub(point, par.offset as number[]), context, ambiguityEpsilon), evaluateNode(node, point));
    case "scale": {
      const factor = par.factor as number[];
      const local = point.map((v, i) => factor[i] === 0 ? 0 : v / factor[i]);
      return withDistance(resolveNode(children[0], local, context, ambiguityEpsilon), evaluateNode(node, point));
    }
    case "rotate2":
      return withDistance(resolveNode(children[0], mulMat2Point(par.matrix as number[][], point), context, ambiguityEpsilon), evaluateNode(node, point));
    case "rotate3":
      return withDistance(resolveNode(children[0], mulMat3Point(par.matrix as number[][], point), context, ambiguityEpsilon), evaluateNode(node, point));
    case "circularArray2":
      return resolveCircularArray2(node, point, context, ambiguityEpsilon);
    case "circularArray3":
      return resolveCircularArray3(node, point, context, ambiguityEpsilon);
    case "elongate2": {
      const q = sub(point.map(Math.abs), par.size as number[]);
      return withDistance(resolveNode(children[0], maxVec(q, 0), context, ambiguityEpsilon), evaluateNode(node, point));
    }
    case "elongate3": {
      const q = sub(point.map(Math.abs), par.size as number[]);
      return withDistance(resolveNode(children[0], maxVec(q, 0), context, ambiguityEpsilon), evaluateNode(node, point));
    }
    case "twist": {
      const k = par.k as number;
      const c = Math.cos(k * point[2]);
      const s = Math.sin(k * point[2]);
      return withDistance(resolveNode(children[0], [c * point[0] - s * point[1], s * point[0] + c * point[1], point[2]], context, ambiguityEpsilon), evaluateNode(node, point));
    }
    case "bend": {
      const k = par.k as number;
      const c = Math.cos(k * point[0]);
      const s = Math.sin(k * point[0]);
      return withDistance(resolveNode(children[0], [c * point[0] - s * point[1], s * point[0] + c * point[1], point[2]], context, ambiguityEpsilon), evaluateNode(node, point));
    }
    case "bendLinear": {
      const params = par as { p0: number[]; p1: number[]; v: number[]; ease: string };
      const ab = sub(params.p1, params.p0);
      const t = easeParam(params.ease, clamp(dot(sub(point, params.p0), ab) / dot(ab, ab), 0, 1));
      return withDistance(resolveNode(children[0], add(point, mul(params.v, t)), context, ambiguityEpsilon), evaluateNode(node, point));
    }
    case "bendRadial": {
      const params = par as { r0: number; r1: number; dz: number; ease: string };
      const r = Math.hypot(point[0], point[1]);
      const t = easeParam(params.ease, clamp((r - params.r0) / (params.r1 - params.r0), 0, 1));
      return withDistance(resolveNode(children[0], [point[0], point[1], point[2] - params.dz * t], context, ambiguityEpsilon), evaluateNode(node, point));
    }
    case "transitionLinear":
      return resolveTransitionLinear(node, point, context, ambiguityEpsilon);
    case "transitionRadial":
      return resolveTransitionRadial(node, point, context, ambiguityEpsilon);
    case "wrapAround": {
      const params = par as { x0: number; x1: number; r: number; ease: string };
      const d = Math.hypot(point[0], point[1]) - params.r;
      const a = Math.atan2(point[1], point[0]);
      const t = easeParam(params.ease, (a + Math.PI) / (2 * Math.PI));
      return withDistance(resolveNode(children[0], [mix(params.x0, params.x1, t), -d, point[2]], context, ambiguityEpsilon), evaluateNode(node, point));
    }
    case "slice":
      return withDistance(resolveNode(children[0], [point[0], point[1], 0], context, ambiguityEpsilon), evaluateNode(node, point));
    case "extrude":
      return withDistance(resolveNode(children[0], [point[0], point[1]], context, ambiguityEpsilon), evaluateNode(node, point));
    case "extrudeTo":
      return resolveExtrudeTo(node, point, context, ambiguityEpsilon);
    case "revolve": {
      const offset = par.offset as number;
      return withDistance(resolveNode(children[0], [Math.hypot(point[0], point[1]) - offset, point[2]], context, ambiguityEpsilon), evaluateNode(node, point));
    }
    default:
      return {
        ...context,
        distance: evaluateNode(node, point),
        ambiguous: false,
        ownerNodeId: node.id,
      };
  }
}

function resolveExtremum(
  node: Node,
  point: number[],
  context: ResolveContext,
  ambiguityEpsilon: number,
  mode: "min" | "max",
): PartialAnnotation {
  const children = node.children.map((child) => child.node);
  const params = node.params as { entries?: Array<{ k: number | null }> };
  let selected = resolveNode(children[0], point, context, ambiguityEpsilon);
  let ambiguous = selected.ambiguous;
  for (let i = 1; i < children.length; i += 1) {
    const next = resolveNode(children[i], point, context, ambiguityEpsilon);
    const smooth = params.entries?.[i]?.k;
    const delta = next.distance - selected.distance;
    const threshold = Math.max(ambiguityEpsilon, smooth == null ? 0 : Math.abs(smooth) * 0.5);
    ambiguous = ambiguous || next.ambiguous || Math.abs(delta) <= threshold;
    if ((mode === "min" && next.distance < selected.distance) || (mode === "max" && next.distance > selected.distance)) {
      selected = next;
    }
  }
  return withDistance(selected, evaluateNode(node, point), ambiguous);
}

function resolveRepeat(node: Node, point: number[], context: ResolveContext, ambiguityEpsilon: number): PartialAnnotation {
  const par = node.params as { spacing: number[]; count: number[] | null; padding: number[] };
  const q = point.map((v, i) => par.spacing[i] === 0 ? 0 : v / par.spacing[i]);
  const index = q.map((v, i) => {
    const rounded = Math.round(v);
    return par.count ? clamp(rounded, -par.count[i], par.count[i]) : rounded;
  });
  let selected: PartialAnnotation | null = null;
  let ambiguous = false;
  for (const n of repeatOffsets(par.padding)) {
    const local = point.map((v, i) => v - par.spacing[i] * (index[i] + n[i]));
    const next = resolveNode(node.children[0].node, local, context, ambiguityEpsilon);
    ambiguous = ambiguous || next.ambiguous || Boolean(selected && Math.abs(next.distance - selected.distance) <= ambiguityEpsilon);
    if (!selected || next.distance < selected.distance) selected = next;
  }
  return withDistance(selected ?? fallback(node, context, point), evaluateNode(node, point), ambiguous);
}

function resolveCircularArray2(node: Node, point: number[], context: ResolveContext, ambiguityEpsilon: number): PartialAnnotation {
  const count = node.params.count as number;
  const da = 2 * Math.PI / count;
  const d = Math.hypot(point[0], point[1]);
  const a = modulo(Math.atan2(point[1], point[0]), da);
  const p0 = [Math.cos(a - da) * d, Math.sin(a - da) * d];
  const p1 = [Math.cos(a) * d, Math.sin(a) * d];
  return chooseBetween(node, point, p0, p1, context, ambiguityEpsilon);
}

function resolveCircularArray3(node: Node, point: number[], context: ResolveContext, ambiguityEpsilon: number): PartialAnnotation {
  const params = node.params as { count: number; offset: number };
  const da = 2 * Math.PI / params.count;
  const d = Math.hypot(point[0], point[1]);
  const a = modulo(Math.atan2(point[1], point[0]), da);
  const p0 = [Math.cos(a - da) * d - params.offset, Math.sin(a - da) * d, point[2]];
  const p1 = [Math.cos(a) * d - params.offset, Math.sin(a) * d, point[2]];
  const a0 = resolveNode(node.children[0].node, p0, context, ambiguityEpsilon);
  const a1 = resolveNode(node.children[0].node, p1, context, ambiguityEpsilon);
  const selected = a0.distance <= a1.distance ? a0 : a1;
  return withDistance(selected, evaluateNode(node, point), a0.ambiguous || a1.ambiguous || Math.abs(a0.distance - a1.distance) <= ambiguityEpsilon);
}

function chooseBetween(node: Node, point: number[], p0: number[], p1: number[], context: ResolveContext, ambiguityEpsilon: number): PartialAnnotation {
  const a0 = resolveNode(node.children[0].node, p0, context, ambiguityEpsilon);
  const a1 = resolveNode(node.children[0].node, p1, context, ambiguityEpsilon);
  const selected = a0.distance <= a1.distance ? a0 : a1;
  return withDistance(selected, evaluateNode(node, point), a0.ambiguous || a1.ambiguous || Math.abs(a0.distance - a1.distance) <= ambiguityEpsilon);
}

function resolveTransitionLinear(node: Node, point: number[], context: ResolveContext, ambiguityEpsilon: number): PartialAnnotation {
  const params = node.params as { p0: number[]; p1: number[]; ease: string };
  const ab = sub(params.p1, params.p0);
  const t = easeParam(params.ease, clamp(dot(sub(point, params.p0), ab) / dot(ab, ab), 0, 1));
  const left = resolveNode(node.children[0].node, point, context, ambiguityEpsilon);
  const right = resolveNode(node.children[1].node, point, context, ambiguityEpsilon);
  const selected = t < 0.5 ? left : right;
  return withDistance(selected, evaluateNode(node, point), left.ambiguous || right.ambiguous || Math.abs(t - 0.5) <= 0.05);
}

function resolveTransitionRadial(node: Node, point: number[], context: ResolveContext, ambiguityEpsilon: number): PartialAnnotation {
  const params = node.params as { r0: number; r1: number; ease: string };
  const r = Math.hypot(point[0], point[1]);
  const t = easeParam(params.ease, clamp((r - params.r0) / (params.r1 - params.r0), 0, 1));
  const left = resolveNode(node.children[0].node, point, context, ambiguityEpsilon);
  const right = resolveNode(node.children[1].node, point, context, ambiguityEpsilon);
  const selected = t < 0.5 ? left : right;
  return withDistance(selected, evaluateNode(node, point), left.ambiguous || right.ambiguous || Math.abs(t - 0.5) <= 0.05);
}

function resolveExtrudeTo(node: Node, point: number[], context: ResolveContext, ambiguityEpsilon: number): PartialAnnotation {
  const params = node.params as { h: number; ease: string };
  const t = easeParam(params.ease, clamp(point[2] / params.h, -0.5, 0.5) + 0.5);
  const left = resolveNode(node.children[0].node, [point[0], point[1]], context, ambiguityEpsilon);
  const right = resolveNode(node.children[1].node, [point[0], point[1]], context, ambiguityEpsilon);
  const selected = t < 0.5 ? left : right;
  return withDistance(selected, evaluateNode(node, point), left.ambiguous || right.ambiguous || Math.abs(t - 0.5) <= 0.05);
}

function fallback(node: Node, context: ResolveContext, point: number[]): PartialAnnotation {
  return {
    ...context,
    distance: evaluateNode(node, point),
    ambiguous: false,
    ownerNodeId: node.id,
  };
}

function withDistance(annotation: PartialAnnotation, distance: number, ambiguous = annotation.ambiguous): PartialAnnotation {
  return {
    ...annotation,
    distance,
    ambiguous,
  };
}

function evaluateNode(node: Node, point: number[]): number {
  return node.dim === 2 ? eval2Node(node, point) : eval3Node(node, point);
}
