import { eval2Node } from "./evaluate2";
import { easeParam, evalCommon, params } from "./common";
import type { Node, SDF3 } from "../core/nodes";
import {
  X,
  abs,
  add,
  clamp,
  div,
  dot,
  length,
  maxComponent,
  maxVec,
  mix,
  modulo,
  mul,
  mulMat3Point,
  normalize,
  sub,
} from "../core/math";

export function evaluate3(sdf: SDF3, p: ArrayLike<number>): number {
  return eval3Node(sdf.node, Array.from(p).slice(0, 3));
}

export function eval3Node(node: Node, p: number[]): number {
  const common = evalCommon(node, p, eval3Node);
  if (common != null) return common;

  const children = node.children.map((child) => child.node);

  switch (node.kind) {
    case "sphere": {
      const par = params<{ radius: number; center: number[] }>(node);
      return length(sub(p, par.center)) - par.radius;
    }
    case "plane": {
      const par = params<{ normal: number[]; point: number[] }>(node);
      return dot(sub(par.point, p), par.normal);
    }
    case "box": {
      const par = params<{ size: number[]; center: number[] }>(node);
      const q = sub(abs(sub(p, par.center)), mul(par.size, 0.5));
      return length(maxVec(q, 0)) + Math.min(maxComponent(q), 0);
    }
    case "roundedBox": {
      const par = params<{ size: number[]; radius: number }>(node);
      const q = add(sub(abs(p), mul(par.size, 0.5)), [par.radius, par.radius, par.radius]);
      return length(maxVec(q, 0)) + Math.min(maxComponent(q), 0) - par.radius;
    }
    case "wireframeBox": {
      const par = params<{ size: number[]; thickness: number }>(node);
      const g = (a: number, b: number, c: number) => length(maxVec([a, b, c], 0)) + Math.min(Math.max(a, Math.max(b, c)), 0);
      const p0 = sub(abs(p), add(mul(par.size, 0.5), [par.thickness / 2, par.thickness / 2, par.thickness / 2]));
      const q = sub(abs(add(p0, [par.thickness / 2, par.thickness / 2, par.thickness / 2])), [par.thickness / 2, par.thickness / 2, par.thickness / 2]);
      return Math.min(Math.min(g(p0[0], q[1], q[2]), g(q[0], p0[1], q[2])), g(q[0], q[1], p0[2]));
    }
    case "torus": {
      const par = params<{ r1: number; r2: number }>(node);
      return length([length([p[0], p[1]]) - par.r1, p[2]]) - par.r2;
    }
    case "capsule": {
      const par = params<{ a: number[]; b: number[]; radius: number }>(node);
      const pa = sub(p, par.a);
      const ba = sub(par.b, par.a);
      const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1);
      return length(sub(pa, mul(ba, h))) - par.radius;
    }
    case "cylinder": {
      const par = params<{ radius: number }>(node);
      return length([p[0], p[1]]) - par.radius;
    }
    case "cappedCylinder": {
      const par = params<{ a: number[]; b: number[]; radius: number }>(node);
      const ba = sub(par.b, par.a);
      const pa = sub(p, par.a);
      const baba = dot(ba, ba);
      const paba = dot(pa, ba);
      const x = length(sub(mul(pa, baba), mul(ba, paba))) - par.radius * baba;
      const y = Math.abs(paba - baba * 0.5) - baba * 0.5;
      const d = Math.max(x, y) < 0 ? -Math.min(x * x, y * y * baba) : (x > 0 ? x * x : 0) + (y > 0 ? y * y * baba : 0);
      return Math.sign(d) * Math.sqrt(Math.abs(d)) / baba;
    }
    case "roundedCylinder": {
      const par = params<{ ra: number; rb: number; h: number }>(node);
      const d = [length([p[0], p[1]]) - par.ra + par.rb, Math.abs(p[2]) - par.h / 2 + par.rb];
      return Math.min(Math.max(d[0], d[1]), 0) + length(maxVec(d, 0)) - par.rb;
    }
    case "cappedCone": {
      const par = params<{ a: number[]; b: number[]; ra: number; rb: number }>(node);
      const ba = sub(par.b, par.a);
      const pa = sub(p, par.a);
      const rba = par.rb - par.ra;
      const baba = dot(ba, ba);
      const papa = dot(pa, pa);
      const paba = dot(pa, ba) / baba;
      const x = Math.sqrt(Math.max(0, papa - paba * paba * baba));
      const cax = Math.max(0, x - (paba < 0.5 ? par.ra : par.rb));
      const cay = Math.abs(paba - 0.5) - 0.5;
      const k = rba * rba + baba;
      const f = clamp((rba * (x - par.ra) + paba * baba) / k, 0, 1);
      const cbx = x - par.ra - f * rba;
      const cby = paba - f;
      const s = cbx < 0 && cay < 0 ? -1 : 1;
      return s * Math.sqrt(Math.min(cax * cax + cay * cay * baba, cbx * cbx + cby * cby * baba));
    }
    case "roundedCone": {
      const par = params<{ r1: number; r2: number; h: number }>(node);
      const q = [length([p[0], p[1]]), p[2]];
      const b = (par.r1 - par.r2) / par.h;
      const a = Math.sqrt(Math.max(0, 1 - b * b));
      const k = dot(q, [-b, a]);
      const c1 = length(q) - par.r1;
      const c2 = length(sub(q, [0, par.h])) - par.r2;
      const c3 = dot(q, [a, b]) - par.r1;
      return k < 0 ? c1 : k > a * par.h ? c2 : c3;
    }
    case "ellipsoid": {
      const par = params<{ size: number[] }>(node);
      const k0 = length(div(p, par.size));
      const k1 = length(div(p, mul(par.size, par.size)));
      if (k1 === 0) return -Math.min(...par.size);
      return k0 * (k0 - 1) / k1;
    }
    case "pyramid": {
      const par = params<{ h: number }>(node);
      let a = sub(abs([p[0], p[1]]), [0.5, 0.5]);
      if (a[1] > a[0]) a = [a[1], a[0]];
      const px = a[0], py = p[2], pz = a[1];
      const m2 = par.h * par.h + 0.25;
      const qx = pz;
      const qy = par.h * py - 0.5 * px;
      const qz = par.h * px + 0.5 * py;
      const s = Math.max(-qx, 0);
      const t = clamp((qy - 0.5 * pz) / (m2 + 0.25), 0, 1);
      const da = m2 * (qx + s) ** 2 + qy ** 2;
      const db = m2 * (qx + 0.5 * t) ** 2 + (qy - m2 * t) ** 2;
      const d2 = Math.min(qy, -qx * m2 - qy * 0.5) > 0 ? 0 : Math.min(da, db);
      return Math.sqrt((d2 + qz * qz) / m2) * Math.sign(Math.max(qz, -py));
    }
    case "tetrahedron": {
      const par = params<{ r: number }>(node);
      return (Math.max(Math.abs(p[0] + p[1]) - p[2], Math.abs(p[0] - p[1]) + p[2]) - par.r) / Math.sqrt(3);
    }
    case "octahedron": {
      const par = params<{ r: number }>(node);
      return (Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2]) - par.r) * Math.tan(Math.PI / 6);
    }
    case "dodecahedron": {
      const par = params<{ r: number }>(node);
      const [x, y, z] = normalize([(1 + Math.sqrt(5)) / 2, 1, 0]);
      const pp = abs(div(p, par.r));
      return (Math.max(dot(pp, [x, y, z]), dot(pp, [z, x, y]), dot(pp, [y, z, x])) - x) * par.r;
    }
    case "icosahedron": {
      const par = params<{ r: number }>(node);
      const r = par.r * 0.8506507174597755;
      const [x, y, z] = normalize([(Math.sqrt(5) + 3) / 2, 1, 0]);
      const w = Math.sqrt(3) / 3;
      const pp = abs(div(p, r));
      return Math.max(Math.max(dot(pp, [x, y, z]), dot(pp, [z, x, y]), dot(pp, [y, z, x])) - x, dot(pp, [w, w, w]) - x) * r;
    }
    case "translate": {
      const par = params<{ offset: number[] }>(node);
      return eval3Node(children[0], sub(p, par.offset));
    }
    case "scale": {
      const par = params<{ factor: number[]; scaleDistance: number }>(node);
      return eval3Node(children[0], p.map((v, i) => par.factor[i] === 0 ? 0 : v / par.factor[i])) * par.scaleDistance;
    }
    case "rotate3": {
      const par = params<{ matrix: number[][] }>(node);
      return eval3Node(children[0], mulMat3Point(par.matrix, p));
    }
    case "circularArray3": {
      const par = params<{ count: number; offset: number }>(node);
      const da = 2 * Math.PI / par.count;
      const d = Math.hypot(p[0], p[1]);
      const a = modulo(Math.atan2(p[1], p[0]), da);
      const shifted = node.children[0].translate(mul(X, par.offset)).node;
      const d1 = eval3Node(shifted, [Math.cos(a - da) * d, Math.sin(a - da) * d, p[2]]);
      const d2 = eval3Node(shifted, [Math.cos(a) * d, Math.sin(a) * d, p[2]]);
      return Math.min(d1, d2);
    }
    case "elongate3": {
      const par = params<{ size: number[] }>(node);
      const q = sub(abs(p), par.size);
      const w = Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0);
      return eval3Node(children[0], maxVec(q, 0)) + w;
    }
    case "twist": {
      const par = params<{ k: number }>(node);
      const c = Math.cos(par.k * p[2]);
      const s = Math.sin(par.k * p[2]);
      return eval3Node(children[0], [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]);
    }
    case "bend": {
      const par = params<{ k: number }>(node);
      const c = Math.cos(par.k * p[0]);
      const s = Math.sin(par.k * p[0]);
      return eval3Node(children[0], [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]);
    }
    case "bendLinear": {
      const par = params<{ p0: number[]; p1: number[]; v: number[]; ease: string }>(node);
      const ab = sub(par.p1, par.p0);
      const t = easeParam(par.ease, clamp(dot(sub(p, par.p0), ab) / dot(ab, ab), 0, 1));
      return eval3Node(children[0], add(p, mul(par.v, t)));
    }
    case "bendRadial": {
      const par = params<{ r0: number; r1: number; dz: number; ease: string }>(node);
      const r = Math.hypot(p[0], p[1]);
      const t = easeParam(par.ease, clamp((r - par.r0) / (par.r1 - par.r0), 0, 1));
      return eval3Node(children[0], [p[0], p[1], p[2] - par.dz * t]);
    }
    case "transitionLinear": {
      const par = params<{ p0: number[]; p1: number[]; ease: string }>(node);
      const ab = sub(par.p1, par.p0);
      const t = easeParam(par.ease, clamp(dot(sub(p, par.p0), ab) / dot(ab, ab), 0, 1));
      return mix(eval3Node(children[0], p), eval3Node(children[1], p), t);
    }
    case "transitionRadial": {
      const par = params<{ r0: number; r1: number; ease: string }>(node);
      const r = Math.hypot(p[0], p[1]);
      const t = easeParam(par.ease, clamp((r - par.r0) / (par.r1 - par.r0), 0, 1));
      return mix(eval3Node(children[0], p), eval3Node(children[1], p), t);
    }
    case "wrapAround": {
      const par = params<{ x0: number; x1: number; r: number; ease: string }>(node);
      const d = Math.hypot(p[0], p[1]) - par.r;
      const a = Math.atan2(p[1], p[0]);
      const t = easeParam(par.ease, (a + Math.PI) / (2 * Math.PI));
      return eval3Node(children[0], [mix(par.x0, par.x1, t), -d, p[2]]);
    }
    case "extrude": {
      const par = params<{ h: number }>(node);
      const d = eval2Node(children[0], [p[0], p[1]]);
      const w = [d, Math.abs(p[2]) - par.h / 2];
      return Math.min(Math.max(w[0], w[1]), 0) + length(maxVec(w, 0));
    }
    case "extrudeTo": {
      const par = params<{ h: number; ease: string }>(node);
      const d1 = eval2Node(children[0], [p[0], p[1]]);
      const d2 = eval2Node(children[1], [p[0], p[1]]);
      const t = easeParam(par.ease, clamp(p[2] / par.h, -0.5, 0.5) + 0.5);
      const d = mix(d1, d2, t);
      const w = [d, Math.abs(p[2]) - par.h / 2];
      return Math.min(Math.max(w[0], w[1]), 0) + length(maxVec(w, 0));
    }
    case "revolve": {
      const par = params<{ offset: number }>(node);
      return eval2Node(children[0], [Math.hypot(p[0], p[1]) - par.offset, p[2]]);
    }
    default:
      throw new Error(`unsupported 3D node: ${node.kind}`);
  }
}
