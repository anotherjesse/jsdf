import { eval3Node } from "./evaluate3";
import { easeParam, evalCommon, params } from "./common";
import type { Node, SDF2 } from "../core/nodes";
import { abs, clamp, dot, length, maxComponent, maxVec, mix, modulo, mul, mulMat2Point, sub } from "../core/math";

export function evaluate2(sdf: SDF2, p: ArrayLike<number>): number {
  return eval2Node(sdf.node, Array.from(p).slice(0, 2));
}

export function eval2Node(node: Node, p: number[]): number {
  const common = evalCommon(node, p, eval2Node);
  if (common != null) return common;

  const children = node.children.map((child) => child.node);

  switch (node.kind) {
    case "circle": {
      const par = params<{ radius: number; center: number[] }>(node);
      return length(sub(p, par.center)) - par.radius;
    }
    case "line": {
      const par = params<{ normal: number[]; point: number[] }>(node);
      return dot(sub(par.point, p), par.normal);
    }
    case "rectangle": {
      const par = params<{ size: number[]; center: number[] }>(node);
      const q = sub(abs(sub(p, par.center)), mul(par.size, 0.5));
      return length(maxVec(q, 0)) + Math.min(maxComponent(q), 0);
    }
    case "roundedRectangle": {
      const par = params<{ size: number[]; radius: number[]; center: number[] }>(node);
      const centered = sub(p, par.center);
      const [x, y] = centered;
      let r = par.radius[2];
      if (x > 0 && y > 0) r = par.radius[0];
      else if (x > 0 && y <= 0) r = par.radius[1];
      else if (x <= 0 && y > 0) r = par.radius[3];
      const q = sub(abs(centered), mul(par.size, 0.5)).map((v) => v + r);
      return Math.min(Math.max(q[0], q[1]), 0) + length(maxVec(q, 0)) - r;
    }
    case "equilateralTriangle": {
      const k = Math.sqrt(3);
      let pp = [Math.abs(p[0]) - 1, p[1] + 1 / k];
      if (pp[0] + k * pp[1] > 0) pp = [(pp[0] - k * pp[1]) / 2, (-k * pp[0] - pp[1]) / 2];
      pp = [pp[0] - clamp(pp[0], -2, 0), pp[1]];
      return -length(pp) * Math.sign(pp[1]);
    }
    case "hexagon": {
      const par = params<{ r: number }>(node);
      const r = par.r * Math.sqrt(3) / 2;
      const k = [-Math.sqrt(3) / 2, 0.5, Math.tan(Math.PI / 6)];
      let pp = abs(p);
      pp = sub(pp, mul(k.slice(0, 2), 2 * Math.min(dot(k.slice(0, 2), pp), 0)));
      pp = sub(pp, [clamp(pp[0], -k[2] * r, k[2] * r), r]);
      return length(pp) * Math.sign(pp[1]);
    }
    case "roundedX": {
      const par = params<{ w: number; r: number }>(node);
      const pp = abs(p);
      const q = Math.min(pp[0] + pp[1], par.w) * 0.5;
      return length(sub(pp, [q, q])) - par.r;
    }
    case "polygon": {
      const par = params<{ points: number[][] }>(node);
      let d = dot(sub(p, par.points[0]), sub(p, par.points[0]));
      let sign = 1;
      for (let i = 0; i < par.points.length; i += 1) {
        const j = (i + par.points.length - 1) % par.points.length;
        const vi = par.points[i];
        const vj = par.points[j];
        const e = sub(vj, vi);
        const w = sub(p, vi);
        const b = sub(w, mul(e, clamp(dot(w, e) / dot(e, e), 0, 1)));
        d = Math.min(d, dot(b, b));
        const c1 = p[1] >= vi[1];
        const c2 = p[1] < vj[1];
        const c3 = e[0] * w[1] > e[1] * w[0];
        if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
      }
      return sign * Math.sqrt(d);
    }
    case "vesica": {
      const par = params<{ r: number; d: number }>(node);
      const pp = abs(p);
      const b = Math.sqrt(par.r * par.r - par.d * par.d);
      return (pp[1] - b) * par.d > pp[0] * b ? length(sub(pp, [0, b])) : length(sub(pp, [-par.d, 0])) - par.r;
    }
    case "translate": {
      const par = params<{ offset: number[] }>(node);
      return eval2Node(children[0], sub(p, par.offset));
    }
    case "scale": {
      const par = params<{ factor: number[]; scaleDistance: number }>(node);
      return eval2Node(children[0], p.map((v, i) => par.factor[i] === 0 ? 0 : v / par.factor[i])) * par.scaleDistance;
    }
    case "rotate2": {
      const par = params<{ matrix: number[][] }>(node);
      return eval2Node(children[0], mulMat2Point(par.matrix, p));
    }
    case "circularArray2": {
      const par = params<{ count: number }>(node);
      const da = 2 * Math.PI / par.count;
      const d = Math.hypot(p[0], p[1]);
      const a = modulo(Math.atan2(p[1], p[0]), da);
      const d1 = eval2Node(children[0], [Math.cos(a - da) * d, Math.sin(a - da) * d]);
      const d2 = eval2Node(children[0], [Math.cos(a) * d, Math.sin(a) * d]);
      return Math.min(d1, d2);
    }
    case "elongate2": {
      const par = params<{ size: number[] }>(node);
      const q = sub(abs(p), par.size);
      const w = Math.min(Math.max(q[0], q[1]), 0);
      return eval2Node(children[0], maxVec(q, 0)) + w;
    }
    case "slice":
      return eval3Node(children[0], [p[0], p[1], 0]);
    default:
      throw new Error(`unsupported 2D node: ${node.kind}`);
  }
}
