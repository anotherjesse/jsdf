import { easeValue, type EaseName } from "../core/ease";
import { repeatOffsets, type Node } from "../core/nodes";
import { clamp, mix } from "../core/math";

export type EvalFn = (node: Node, p: number[]) => number;

export function params<T extends Record<string, unknown>>(node: Node): T {
  return node.params as T;
}

export function evalCommon(node: Node, p: number[], evalChild: EvalFn): number | null {
  const children = node.children.map((child) => child.node);
  const par = params<{ entries: Array<{ k: number | null }>; k?: number | null; r: number; thickness: number; spacing: number[]; count: number[] | null; padding: number[] }>(node);

  switch (node.kind) {
    case "name":
    case "color":
      return evalChild(children[0], p);
    case "union": {
      let d1 = evalChild(children[0], p);
      for (let i = 1; i < children.length; i += 1) {
        const d2 = evalChild(children[i], p);
        const k = par.entries[i].k;
        if (k == null) d1 = Math.min(d1, d2);
        else {
          const h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0, 1);
          d1 = mix(d2, d1, h) - k * h * (1 - h);
        }
      }
      return d1;
    }
    case "difference": {
      let d1 = evalChild(children[0], p);
      for (let i = 1; i < children.length; i += 1) {
        const d2 = evalChild(children[i], p);
        const k = par.entries[i].k;
        if (k == null) d1 = Math.max(d1, -d2);
        else {
          const h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0, 1);
          d1 = mix(d1, -d2, h) + k * h * (1 - h);
        }
      }
      return d1;
    }
    case "intersection": {
      let d1 = evalChild(children[0], p);
      for (let i = 1; i < children.length; i += 1) {
        const d2 = evalChild(children[i], p);
        const k = par.entries[i].k;
        if (k == null) d1 = Math.max(d1, d2);
        else {
          const h = clamp(0.5 - 0.5 * (d2 - d1) / k, 0, 1);
          d1 = mix(d2, d1, h) + k * h * (1 - h);
        }
      }
      return d1;
    }
    case "blend": {
      let d1 = evalChild(children[0], p);
      for (let i = 1; i < children.length; i += 1) {
        const d2 = evalChild(children[i], p);
        const k = par.entries[i].k ?? par.k ?? 0.5;
        d1 = k * d2 + (1 - k) * d1;
      }
      return d1;
    }
    case "negate":
      return -evalChild(children[0], p);
    case "dilate":
      return evalChild(children[0], p) - par.r;
    case "erode":
      return evalChild(children[0], p) + par.r;
    case "shell":
      return Math.abs(evalChild(children[0], p)) - par.thickness / 2;
    case "repeat":
      return evalRepeat(node, p, evalChild);
    default:
      return null;
  }
}

function evalRepeat(node: Node, p: number[], evalChild: EvalFn): number {
  const par = params<{ spacing: number[]; count: number[] | null; padding: number[] }>(node);
  const q = p.map((v, i) => par.spacing[i] === 0 ? 0 : v / par.spacing[i]);
  const index = q.map((v, i) => {
    const rounded = Math.round(v);
    return par.count ? clamp(rounded, -par.count[i], par.count[i]) : rounded;
  });
  let d = Infinity;
  for (const n of repeatOffsets(par.padding)) {
    const pp = p.map((v, i) => v - par.spacing[i] * (index[i] + n[i]));
    d = Math.min(d, evalChild(node.children[0].node, pp));
  }
  return d;
}

export function easeParam(name: unknown, t: number): number {
  return easeValue((name || "linear") as EaseName, t);
}
