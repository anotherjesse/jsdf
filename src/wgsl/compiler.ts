import type { EaseName } from "../core/ease";
import type { Node, SDF3 } from "../core/nodes";
import { repeatOffsets } from "../core/nodes";
import { normalize } from "../core/math";
import { f, fnName, mat2Mul, mat3Mul, p, v2, v3 } from "./format";
import { WGSL_HELPERS } from "./helpers";

type Dim = 2 | 3;

export interface CompiledScene {
  source: string;
  sceneFunction: string;
}

export function compileScene(sdf: SDF3): CompiledScene {
  const compiler = new Compiler();
  compiler.emit(sdf.node);
  return {
    source: `${WGSL_HELPERS}\n${compiler.source()}\nfn scene(p: vec3f) -> f32 { return ${fnName(sdf.node)}(p); }\n`,
    sceneFunction: fnName(sdf.node),
  };
}

class Compiler {
  private readonly emitted = new Set<number>();
  private readonly chunks: string[] = [];

  source(): string {
    return this.chunks.join("\n");
  }

  emit(node: Node): void {
    if (this.emitted.has(node.id)) return;
    for (const child of node.children) this.emit(child.node);
    this.emitted.add(node.id);
    this.chunks.push(node.dim === 2 ? this.emit2(node) : this.emit3(node));
  }

  private emit2(node: Node): string {
    return `fn ${fnName(node)}(p: vec2f) -> f32 {\n${this.body(node, 2)}\n}`;
  }

  private emit3(node: Node): string {
    return `fn ${fnName(node)}(p: vec3f) -> f32 {\n${this.body(node, 3)}\n}`;
  }

  private body(node: Node, dim: Dim): string {
    const common = this.commonBody(node, dim);
    if (common) return common;
    return dim === 2 ? this.body2(node) : this.body3(node);
  }

  private commonBody(node: Node, dim: Dim): string | null {
    const children = node.children.map((child) => child.node);
    const call = (child: Node, arg = "p") => `${fnName(child)}(${arg})`;
    const par = p<{ entries: Array<{ k: number | null }>; k?: number | null; r: number; thickness: number; spacing: number[]; count: number[] | null; padding: number[] }>(node);

    if (node.kind === "union" || node.kind === "difference" || node.kind === "intersection" || node.kind === "blend") {
      const lines = [`  var d = ${call(children[0])};`];
      for (let i = 1; i < children.length; i += 1) {
        const d2 = `d2_${i}`;
        lines.push(`  let ${d2} = ${call(children[i])};`);
        const k = par.entries[i].k;
        if (node.kind === "blend") {
          lines.push(`  d = mix(d, ${d2}, ${f(k ?? par.k ?? 0.5)});`);
        } else if (k == null) {
          const op = node.kind === "union" ? `min(d, ${d2})` : node.kind === "difference" ? `max(d, -${d2})` : `max(d, ${d2})`;
          lines.push(`  d = ${op};`);
        } else if (node.kind === "union") {
          lines.push(`  { let h = clamp(0.5 + 0.5 * (${d2} - d) / ${f(k)}, 0.0, 1.0); d = mix(${d2}, d, h) - ${f(k)} * h * (1.0 - h); }`);
        } else if (node.kind === "difference") {
          lines.push(`  { let h = clamp(0.5 - 0.5 * (${d2} + d) / ${f(k)}, 0.0, 1.0); d = mix(d, -${d2}, h) + ${f(k)} * h * (1.0 - h); }`);
        } else {
          lines.push(`  { let h = clamp(0.5 - 0.5 * (${d2} - d) / ${f(k)}, 0.0, 1.0); d = mix(${d2}, d, h) + ${f(k)} * h * (1.0 - h); }`);
        }
      }
      lines.push("  return d;");
      return lines.join("\n");
    }

    if (node.kind === "negate") return `  return -${call(children[0])};`;
    if (node.kind === "dilate") return `  return ${call(children[0])} - ${f(par.r)};`;
    if (node.kind === "erode") return `  return ${call(children[0])} + ${f(par.r)};`;
    if (node.kind === "shell") return `  return abs(${call(children[0])}) - ${f(par.thickness / 2)};`;
    if (node.kind === "repeat") return this.repeatBody(children[0], par, dim);
    return null;
  }

  private repeatBody(child: Node, par: { spacing: number[]; count: number[] | null; padding: number[] }, dim: Dim): string {
    const vec = dim === 2 ? "vec2f" : "vec3f";
    const vv = dim === 2 ? v2 : v3;
    const safe = dim === 2 ? "safe_div2" : "safe_div3";
    const count = par.count ? `clamp(round(q), -${vv(par.count)}, ${vv(par.count)})` : "round(q)";
    const lines = [
      `  let spacing = ${vv(par.spacing)};`,
      `  let q = ${safe}(p, spacing);`,
      `  let index = ${count};`,
      "  var d = 1000000000.0;",
    ];
    for (const offset of repeatOffsets(par.padding)) {
      lines.push(`  d = min(d, ${fnName(child)}(p - spacing * (index + ${vec}(${offset.map(f).join(", ")}))));`);
    }
    lines.push("  return d;");
    return lines.join("\n");
  }

  private body2(node: Node): string {
    const par = node.params as Record<string, unknown>;
    const child = (i = 0, arg = "p") => `${fnName(node.children[i].node)}(${arg})`;

    switch (node.kind) {
      case "circle": return `  return length(p - ${v2(par.center as number[])}) - ${f(par.radius as number)};`;
      case "line": return `  return dot(${v2(par.point as number[])} - p, ${v2(par.normal as number[])});`;
      case "rectangle": return `  let q = abs(p - ${v2(par.center as number[])}) - ${v2((par.size as number[]).map((x) => x / 2))};\n  return length(max(q, vec2f(0.0))) + min(max2(q), 0.0);`;
      case "roundedRectangle": return this.roundedRectangleBody(par);
      case "equilateralTriangle": return `  let k = sqrt(3.0);\n  var q = vec2f(abs(p.x) - 1.0, p.y + 1.0 / k);\n  if (q.x + k * q.y > 0.0) { q = vec2f(q.x - k * q.y, -k * q.x - q.y) / 2.0; }\n  q = vec2f(q.x - clamp(q.x, -2.0, 0.0), q.y);\n  return -length(q) * sgn(q.y);`;
      case "hexagon": {
        const r = (par.r as number) * Math.sqrt(3) / 2;
        return `  let k = vec3f(${f(-Math.sqrt(3) / 2)}, 0.5, ${f(Math.tan(Math.PI / 6))});\n  var q = abs(p);\n  q -= 2.0 * k.xy * min(dot(k.xy, q), 0.0);\n  q -= vec2f(clamp(q.x, -k.z * ${f(r)}, k.z * ${f(r)}), ${f(r)});\n  return length(q) * sgn(q.y);`;
      }
      case "roundedX": return `  let q = abs(p);\n  let d = min(q.x + q.y, ${f(par.w as number)}) * 0.5;\n  return length(q - vec2f(d)) - ${f(par.r as number)};`;
      case "polygon": return this.polygonBody(par.points as number[][]);
      case "vesica": return `  let q = abs(p);\n  let b = sqrt(${f((par.r as number) ** 2 - (par.d as number) ** 2)});\n  if ((q.y - b) * ${f(par.d as number)} > q.x * b) { return length(q - vec2f(0.0, b)); }\n  return length(q - vec2f(${f(-(par.d as number))}, 0.0)) - ${f(par.r as number)};`;
      case "translate": return `  return ${child(0, `p - ${v2(par.offset as number[])}`)};`;
      case "scale": return `  return ${child(0, `safe_div2(p, ${v2(par.factor as number[])})`)} * ${f(par.scaleDistance as number)};`;
      case "rotate2": return `  return ${child(0, mat2Mul(par.matrix as number[][], "p"))};`;
      case "circularArray2": return `  let da = 2.0 * SDF_PI / ${f(par.count as number)};\n  let d = length(p);\n  let a = imod(atan2(p.y, p.x), da);\n  return min(${child(0, "vec2f(cos(a - da) * d, sin(a - da) * d)")}, ${child(0, "vec2f(cos(a) * d, sin(a) * d)")});`;
      case "elongate2": return `  let q = abs(p) - ${v2(par.size as number[])};\n  let w = min(max(q.x, q.y), 0.0);\n  return ${child(0, "max(q, vec2f(0.0))")} + w;`;
      case "slice": return `  return ${fnName(node.children[0].node)}(vec3f(p, 0.0));`;
      default: throw new Error(`unsupported WGSL 2D node: ${node.kind}`);
    }
  }

  private body3(node: Node): string {
    const par = node.params as Record<string, unknown>;
    const child = (i = 0, arg = "p") => `${fnName(node.children[i].node)}(${arg})`;

    switch (node.kind) {
      case "sphere": return `  return length(p - ${v3(par.center as number[])}) - ${f(par.radius as number)};`;
      case "plane": return `  return dot(${v3(par.point as number[])} - p, ${v3(par.normal as number[])});`;
      case "box": return `  let q = abs(p - ${v3(par.center as number[])}) - ${v3((par.size as number[]).map((x) => x / 2))};\n  return length(max(q, vec3f(0.0))) + min(max3(q), 0.0);`;
      case "roundedBox": return `  let q = abs(p) - ${v3((par.size as number[]).map((x) => x / 2))} + vec3f(${f(par.radius as number)});\n  return length(max(q, vec3f(0.0))) + min(max3(q), 0.0) - ${f(par.radius as number)};`;
      case "wireframeBox": return this.wireframeBoxBody(par);
      case "torus": return `  return length(vec2f(length(p.xy) - ${f(par.r1 as number)}, p.z)) - ${f(par.r2 as number)};`;
      case "capsule": return `  let a = ${v3(par.a as number[])};\n  let b = ${v3(par.b as number[])};\n  let pa = p - a;\n  let ba = b - a;\n  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);\n  return length(pa - ba * h) - ${f(par.radius as number)};`;
      case "cylinder": return `  return length(p.xy) - ${f(par.radius as number)};`;
      case "cappedCylinder": return this.cappedCylinderBody(par);
      case "roundedCylinder": return `  let d = vec2f(length(p.xy) - ${f(par.ra as number)} + ${f(par.rb as number)}, abs(p.z) - ${f((par.h as number) / 2)} + ${f(par.rb as number)});\n  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0))) - ${f(par.rb as number)};`;
      case "cappedCone": return this.cappedConeBody(par);
      case "roundedCone": return this.roundedConeBody(par);
      case "ellipsoid": return `  let size = ${v3(par.size as number[])};\n  let k0 = length(p / size);\n  let k1 = length(p / (size * size));\n  if (k1 == 0.0) { return -min(size.x, min(size.y, size.z)); }\n  return k0 * (k0 - 1.0) / k1;`;
      case "pyramid": return this.pyramidBody(par);
      case "tetrahedron": return `  return (max(abs(p.x + p.y) - p.z, abs(p.x - p.y) + p.z) - ${f(par.r as number)}) / sqrt(3.0);`;
      case "octahedron": return `  return (abs(p.x) + abs(p.y) + abs(p.z) - ${f(par.r as number)}) * tan(SDF_PI / 6.0);`;
      case "dodecahedron": return this.dodecahedronBody(par);
      case "icosahedron": return this.icosahedronBody(par);
      case "translate": return `  return ${child(0, `p - ${v3(par.offset as number[])}`)};`;
      case "scale": return `  return ${child(0, `safe_div3(p, ${v3(par.factor as number[])})`)} * ${f(par.scaleDistance as number)};`;
      case "rotate3": return `  return ${child(0, mat3Mul(par.matrix as number[][], "p"))};`;
      case "circularArray3": return `  let da = 2.0 * SDF_PI / ${f(par.count as number)};\n  let d = length(p.xy);\n  let a = imod(atan2(p.y, p.x), da);\n  let offset = ${f(par.offset as number)};\n  return min(${child(0, "vec3f(cos(a - da) * d - offset, sin(a - da) * d, p.z)")}, ${child(0, "vec3f(cos(a) * d - offset, sin(a) * d, p.z)")});`;
      case "elongate3": return `  let q = abs(p) - ${v3(par.size as number[])};\n  let w = min(max(q.x, max(q.y, q.z)), 0.0);\n  return ${child(0, "max(q, vec3f(0.0))")} + w;`;
      case "twist": return `  let c = cos(${f(par.k as number)} * p.z);\n  let s = sin(${f(par.k as number)} * p.z);\n  return ${child(0, "vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z)")};`;
      case "bend": return `  let c = cos(${f(par.k as number)} * p.x);\n  let s = sin(${f(par.k as number)} * p.x);\n  return ${child(0, "vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z)")};`;
      case "bendLinear": return this.bendLinearBody(par, child);
      case "bendRadial": return this.bendRadialBody(par, child);
      case "transitionLinear": return this.transitionLinearBody(par, child);
      case "transitionRadial": return this.transitionRadialBody(par, child);
      case "wrapAround": return `  let d = length(p.xy) - ${f(par.r as number)};\n  let a = atan2(p.y, p.x);\n  let t = ${easeCall(par.ease as EaseName, "(a + SDF_PI) / (2.0 * SDF_PI)")};\n  return ${child(0, `vec3f(mix(${f(par.x0 as number)}, ${f(par.x1 as number)}, t), -d, p.z)`)};`;
      case "extrude": return `  let d = ${fnName(node.children[0].node)}(p.xy);\n  let w = vec2f(d, abs(p.z) - ${f((par.h as number) / 2)});\n  return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0)));`;
      case "extrudeTo": return `  let d1 = ${fnName(node.children[0].node)}(p.xy);\n  let d2 = ${fnName(node.children[1].node)}(p.xy);\n  let t = ${easeCall(par.ease as EaseName, `clamp(p.z / ${f(par.h as number)}, -0.5, 0.5) + 0.5`)};\n  let d = mix(d1, d2, t);\n  let w = vec2f(d, abs(p.z) - ${f((par.h as number) / 2)});\n  return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0)));`;
      case "revolve": return `  return ${fnName(node.children[0].node)}(vec2f(length(p.xy) - ${f(par.offset as number)}, p.z));`;
      default: throw new Error(`unsupported WGSL 3D node: ${node.kind}`);
    }
  }

  private roundedRectangleBody(par: Record<string, unknown>): string {
    const radius = par.radius as number[];
    return `  let q0 = p - ${v2(par.center as number[])};\n  var r = ${f(radius[2])};\n  if (q0.x > 0.0 && q0.y > 0.0) { r = ${f(radius[0])}; }\n  if (q0.x > 0.0 && q0.y <= 0.0) { r = ${f(radius[1])}; }\n  if (q0.x <= 0.0 && q0.y > 0.0) { r = ${f(radius[3])}; }\n  let q = abs(q0) - ${v2((par.size as number[]).map((x) => x / 2))} + vec2f(r);\n  return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;`;
  }

  private polygonBody(points: number[][]): string {
    const lines = [`  var d = dot(p - ${v2(points[0])}, p - ${v2(points[0])});`, "  var s = 1.0;"];
    for (let i = 0; i < points.length; i += 1) {
      const j = (i + points.length - 1) % points.length;
      lines.push(`  { let vi = ${v2(points[i])}; let vj = ${v2(points[j])}; let e = vj - vi; let w = p - vi; let b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0); d = min(d, dot(b, b)); let c1 = p.y >= vi.y; let c2 = p.y < vj.y; let c3 = e.x * w.y > e.y * w.x; if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) { s = -s; } }`);
    }
    lines.push("  return s * sqrt(d);");
    return lines.join("\n");
  }

  private wireframeBoxBody(par: Record<string, unknown>): string {
    return `  let size = ${v3(par.size as number[])};\n  let thickness = ${f(par.thickness as number)};\n  let p0 = abs(p) - size / 2.0 - vec3f(thickness / 2.0);\n  let q = abs(p0 + vec3f(thickness / 2.0)) - vec3f(thickness / 2.0);\n  let a = length(max(vec3f(p0.x, q.y, q.z), vec3f(0.0))) + min(max(p0.x, max(q.y, q.z)), 0.0);\n  let b = length(max(vec3f(q.x, p0.y, q.z), vec3f(0.0))) + min(max(q.x, max(p0.y, q.z)), 0.0);\n  let c = length(max(vec3f(q.x, q.y, p0.z), vec3f(0.0))) + min(max(q.x, max(q.y, p0.z)), 0.0);\n  return min(min(a, b), c);`;
  }

  private cappedCylinderBody(par: Record<string, unknown>): string {
    return `  let a = ${v3(par.a as number[])};\n  let b = ${v3(par.b as number[])};\n  let ba = b - a;\n  let pa = p - a;\n  let baba = dot(ba, ba);\n  let paba = dot(pa, ba);\n  let x = length(pa * baba - ba * paba) - ${f(par.radius as number)} * baba;\n  let y = abs(paba - baba * 0.5) - baba * 0.5;\n  let d = select(select(0.0, x * x, x > 0.0) + select(0.0, y * y * baba, y > 0.0), -min(x * x, y * y * baba), max(x, y) < 0.0);\n  return sgn(d) * sqrt(abs(d)) / baba;`;
  }

  private cappedConeBody(par: Record<string, unknown>): string {
    return `  let a = ${v3(par.a as number[])};\n  let b = ${v3(par.b as number[])};\n  let ba = b - a;\n  let pa = p - a;\n  let rba = ${f((par.rb as number) - (par.ra as number))};\n  let baba = dot(ba, ba);\n  let papa = dot(pa, pa);\n  let paba = dot(pa, ba) / baba;\n  let x = sqrt(max(0.0, papa - paba * paba * baba));\n  let cax = max(0.0, x - select(${f(par.rb as number)}, ${f(par.ra as number)}, paba < 0.5));\n  let cay = abs(paba - 0.5) - 0.5;\n  let k = rba * rba + baba;\n  let ff = clamp((rba * (x - ${f(par.ra as number)}) + paba * baba) / k, 0.0, 1.0);\n  let cbx = x - ${f(par.ra as number)} - ff * rba;\n  let cby = paba - ff;\n  let s = select(1.0, -1.0, cbx < 0.0 && cay < 0.0);\n  return s * sqrt(min(cax * cax + cay * cay * baba, cbx * cbx + cby * cby * baba));`;
  }

  private roundedConeBody(par: Record<string, unknown>): string {
    return `  let q = vec2f(length(p.xy), p.z);\n  let b = ${f(((par.r1 as number) - (par.r2 as number)) / (par.h as number))};\n  let a = sqrt(max(0.0, 1.0 - b * b));\n  let k = dot(q, vec2f(-b, a));\n  let c1 = length(q) - ${f(par.r1 as number)};\n  let c2 = length(q - vec2f(0.0, ${f(par.h as number)})) - ${f(par.r2 as number)};\n  let c3 = dot(q, vec2f(a, b)) - ${f(par.r1 as number)};\n  return select(select(c3, c2, k > a * ${f(par.h as number)}), c1, k < 0.0);`;
  }

  private pyramidBody(par: Record<string, unknown>): string {
    return `  var a = abs(p.xy) - vec2f(0.5);\n  if (a.y > a.x) { a = a.yx; }\n  let px = a.x;\n  let py = p.z;\n  let pz = a.y;\n  let h = ${f(par.h as number)};\n  let m2 = h * h + 0.25;\n  let qx = pz;\n  let qy = h * py - 0.5 * px;\n  let qz = h * px + 0.5 * py;\n  let s = max(-qx, 0.0);\n  let t = clamp((qy - 0.5 * pz) / (m2 + 0.25), 0.0, 1.0);\n  let da = m2 * (qx + s) * (qx + s) + qy * qy;\n  let db = m2 * (qx + 0.5 * t) * (qx + 0.5 * t) + (qy - m2 * t) * (qy - m2 * t);\n  let d2 = select(min(da, db), 0.0, min(qy, -qx * m2 - qy * 0.5) > 0.0);\n  return sqrt((d2 + qz * qz) / m2) * sgn(max(qz, -py));`;
  }

  private dodecahedronBody(par: Record<string, unknown>): string {
    const n = normalize([(1 + Math.sqrt(5)) / 2, 1, 0]);
    return `  let n = ${v3(n)};\n  let q = abs(p / ${f(par.r as number)});\n  let a = dot(q, n.xyz);\n  let b = dot(q, n.zxy);\n  let c = dot(q, n.yzx);\n  return (max(max(a, b), c) - n.x) * ${f(par.r as number)};`;
  }

  private icosahedronBody(par: Record<string, unknown>): string {
    const r = (par.r as number) * 0.8506507174597755;
    const n = normalize([(Math.sqrt(5) + 3) / 2, 1, 0]);
    return `  let n = ${v3(n)};\n  let w = sqrt(3.0) / 3.0;\n  let q = abs(p / ${f(r)});\n  let a = dot(q, n.xyz);\n  let b = dot(q, n.zxy);\n  let c = dot(q, n.yzx);\n  let d = dot(q, vec3f(w)) - n.x;\n  return max(max(max(a, b), c) - n.x, d) * ${f(r)};`;
  }

  private bendLinearBody(par: Record<string, unknown>, child: (i?: number, arg?: string) => string): string {
    return `  let p0 = ${v3(par.p0 as number[])};\n  let p1 = ${v3(par.p1 as number[])};\n  let ab = p1 - p0;\n  let t = ${easeCall(par.ease as EaseName, "clamp(dot(p - p0, ab) / dot(ab, ab), 0.0, 1.0)")};\n  return ${child(0, `p + ${v3(par.v as number[])} * t`)};`;
  }

  private bendRadialBody(par: Record<string, unknown>, child: (i?: number, arg?: string) => string): string {
    return `  let r = length(p.xy);\n  let t = ${easeCall(par.ease as EaseName, `clamp((r - ${f(par.r0 as number)}) / ${f((par.r1 as number) - (par.r0 as number))}, 0.0, 1.0)`)};\n  return ${child(0, `vec3f(p.xy, p.z - ${f(par.dz as number)} * t)`)};`;
  }

  private transitionLinearBody(par: Record<string, unknown>, child: (i?: number, arg?: string) => string): string {
    return `  let p0 = ${v3(par.p0 as number[])};\n  let p1 = ${v3(par.p1 as number[])};\n  let ab = p1 - p0;\n  let t = ${easeCall(par.ease as EaseName, "clamp(dot(p - p0, ab) / dot(ab, ab), 0.0, 1.0)")};\n  return mix(${child(0)}, ${child(1)}, t);`;
  }

  private transitionRadialBody(par: Record<string, unknown>, child: (i?: number, arg?: string) => string): string {
    return `  let r = length(p.xy);\n  let t = ${easeCall(par.ease as EaseName, `clamp((r - ${f(par.r0 as number)}) / ${f((par.r1 as number) - (par.r0 as number))}, 0.0, 1.0)`)};\n  return mix(${child(0)}, ${child(1)}, t);`;
  }
}

function easeCall(name: EaseName, arg: string): string {
  return `ease_${name}(${arg})`;
}
