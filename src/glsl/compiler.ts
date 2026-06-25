import type { EaseName } from "../core/ease";
import type { Node, SDF3 } from "../core/nodes";
import { repeatOffsets } from "../core/nodes";
import { normalize } from "../core/math";
import { f, fnName, mat2Mul, mat3Mul, p, v2, v3 } from "./format";
import { GLSL_HELPERS } from "./helpers";

type Dim = 2 | 3;

export interface CompiledGLSLScene {
  source: string;
  sceneFunction: string;
}

export function compileGLSLScene(sdf: SDF3): CompiledGLSLScene {
  const compiler = new Compiler();
  compiler.emit(sdf.node);
  return {
    source: `${GLSL_HELPERS}\n${compiler.source()}\nfloat scene(vec3 p) { return ${fnName(sdf.node)}(p); }\n`,
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
    return `float ${fnName(node)}(vec2 p) {\n${this.body(node, 2)}\n}`;
  }

  private emit3(node: Node): string {
    return `float ${fnName(node)}(vec3 p) {\n${this.body(node, 3)}\n}`;
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
      const lines = [`  float d = ${call(children[0])};`];
      for (let i = 1; i < children.length; i += 1) {
        const d2 = `d2_${i}`;
        lines.push(`  float ${d2} = ${call(children[i])};`);
        const k = par.entries[i].k;
        if (node.kind === "blend") {
          lines.push(`  d = mix(d, ${d2}, ${f(k ?? par.k ?? 0.5)});`);
        } else if (k == null) {
          const op = node.kind === "union" ? `min(d, ${d2})` : node.kind === "difference" ? `max(d, -${d2})` : `max(d, ${d2})`;
          lines.push(`  d = ${op};`);
        } else if (node.kind === "union") {
          lines.push(`  { float h = clamp(0.5 + 0.5 * (${d2} - d) / ${f(k)}, 0.0, 1.0); d = mix(${d2}, d, h) - ${f(k)} * h * (1.0 - h); }`);
        } else if (node.kind === "difference") {
          lines.push(`  { float h = clamp(0.5 - 0.5 * (${d2} + d) / ${f(k)}, 0.0, 1.0); d = mix(d, -${d2}, h) + ${f(k)} * h * (1.0 - h); }`);
        } else {
          lines.push(`  { float h = clamp(0.5 - 0.5 * (${d2} - d) / ${f(k)}, 0.0, 1.0); d = mix(${d2}, d, h) + ${f(k)} * h * (1.0 - h); }`);
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
    const vec = dim === 2 ? "vec2" : "vec3";
    const vv = dim === 2 ? v2 : v3;
    const safe = dim === 2 ? "safe_div2" : "safe_div3";
    const count = par.count ? `clamp(round(q), -${vv(par.count)}, ${vv(par.count)})` : "round(q)";
    const lines = [
      `  vec${dim} spacing = ${vv(par.spacing)};`,
      `  vec${dim} q = ${safe}(p, spacing);`,
      `  vec${dim} index = ${count};`,
      "  float d = 1000000000.0;",
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
      case "rectangle": return `  vec2 q = abs(p - ${v2(par.center as number[])}) - ${v2((par.size as number[]).map((x) => x / 2))};\n  return length(max(q, vec2(0.0))) + min(max2(q), 0.0);`;
      case "roundedRectangle": return this.roundedRectangleBody(par);
      case "equilateralTriangle": return `  float k = sqrt(3.0);\n  vec2 q = vec2(abs(p.x) - 1.0, p.y + 1.0 / k);\n  if (q.x + k * q.y > 0.0) { q = vec2(q.x - k * q.y, -k * q.x - q.y) / 2.0; }\n  q = vec2(q.x - clamp(q.x, -2.0, 0.0), q.y);\n  return -length(q) * sgn(q.y);`;
      case "hexagon": {
        const r = (par.r as number) * Math.sqrt(3) / 2;
        return `  vec3 k = vec3(${f(-Math.sqrt(3) / 2)}, 0.5, ${f(Math.tan(Math.PI / 6))});\n  vec2 q = abs(p);\n  q -= 2.0 * k.xy * min(dot(k.xy, q), 0.0);\n  q -= vec2(clamp(q.x, -k.z * ${f(r)}, k.z * ${f(r)}), ${f(r)});\n  return length(q) * sgn(q.y);`;
      }
      case "roundedX": return `  vec2 q = abs(p);\n  float d = min(q.x + q.y, ${f(par.w as number)}) * 0.5;\n  return length(q - vec2(d)) - ${f(par.r as number)};`;
      case "polygon": return this.polygonBody(par.points as number[][]);
      case "vesica": return `  vec2 q = abs(p);\n  float b = sqrt(${f((par.r as number) ** 2 - (par.d as number) ** 2)});\n  if ((q.y - b) * ${f(par.d as number)} > q.x * b) { return length(q - vec2(0.0, b)); }\n  return length(q - vec2(${f(-(par.d as number))}, 0.0)) - ${f(par.r as number)};`;
      case "translate": return `  return ${child(0, `p - ${v2(par.offset as number[])}`)};`;
      case "scale": return `  return ${child(0, `safe_div2(p, ${v2(par.factor as number[])})`)} * ${f(par.scaleDistance as number)};`;
      case "rotate2": return `  return ${child(0, mat2Mul(par.matrix as number[][], "p"))};`;
      case "circularArray2": return `  float da = 2.0 * SDF_PI / ${f(par.count as number)};\n  float d = length(p);\n  float a = imod(atan(p.y, p.x), da);\n  return min(${child(0, "vec2(cos(a - da) * d, sin(a - da) * d)")}, ${child(0, "vec2(cos(a) * d, sin(a) * d)")});`;
      case "elongate2": return `  vec2 q = abs(p) - ${v2(par.size as number[])};\n  float w = min(max(q.x, q.y), 0.0);\n  return ${child(0, "max(q, vec2(0.0))")} + w;`;
      case "slice": return `  return ${fnName(node.children[0].node)}(vec3(p, 0.0));`;
      default: throw new Error(`unsupported GLSL 2D node: ${node.kind}`);
    }
  }

  private body3(node: Node): string {
    const par = node.params as Record<string, unknown>;
    const child = (i = 0, arg = "p") => `${fnName(node.children[i].node)}(${arg})`;

    switch (node.kind) {
      case "sphere": return `  return length(p - ${v3(par.center as number[])}) - ${f(par.radius as number)};`;
      case "plane": return `  return dot(${v3(par.point as number[])} - p, ${v3(par.normal as number[])});`;
      case "box": return `  vec3 q = abs(p - ${v3(par.center as number[])}) - ${v3((par.size as number[]).map((x) => x / 2))};\n  return length(max(q, vec3(0.0))) + min(max3(q), 0.0);`;
      case "roundedBox": return `  vec3 q = abs(p) - ${v3((par.size as number[]).map((x) => x / 2))} + vec3(${f(par.radius as number)});\n  return length(max(q, vec3(0.0))) + min(max3(q), 0.0) - ${f(par.radius as number)};`;
      case "wireframeBox": return this.wireframeBoxBody(par);
      case "torus": return `  return length(vec2(length(p.xy) - ${f(par.r1 as number)}, p.z)) - ${f(par.r2 as number)};`;
      case "capsule": return `  vec3 a = ${v3(par.a as number[])};\n  vec3 b = ${v3(par.b as number[])};\n  vec3 pa = p - a;\n  vec3 ba = b - a;\n  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);\n  return length(pa - ba * h) - ${f(par.radius as number)};`;
      case "cylinder": return `  return length(p.xy) - ${f(par.radius as number)};`;
      case "cappedCylinder": return this.cappedCylinderBody(par);
      case "roundedCylinder": return `  vec2 d = vec2(length(p.xy) - ${f(par.ra as number)} + ${f(par.rb as number)}, abs(p.z) - ${f((par.h as number) / 2)} + ${f(par.rb as number)});\n  return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0))) - ${f(par.rb as number)};`;
      case "cappedCone": return this.cappedConeBody(par);
      case "roundedCone": return this.roundedConeBody(par);
      case "ellipsoid": return `  vec3 size = ${v3(par.size as number[])};\n  float k0 = length(p / size);\n  float k1 = length(p / (size * size));\n  if (k1 == 0.0) { return -min(size.x, min(size.y, size.z)); }\n  return k0 * (k0 - 1.0) / k1;`;
      case "pyramid": return this.pyramidBody(par);
      case "tetrahedron": return `  return (max(abs(p.x + p.y) - p.z, abs(p.x - p.y) + p.z) - ${f(par.r as number)}) / sqrt(3.0);`;
      case "octahedron": return `  return (abs(p.x) + abs(p.y) + abs(p.z) - ${f(par.r as number)}) * tan(SDF_PI / 6.0);`;
      case "dodecahedron": return this.dodecahedronBody(par);
      case "icosahedron": return this.icosahedronBody(par);
      case "translate": return `  return ${child(0, `p - ${v3(par.offset as number[])}`)};`;
      case "scale": return `  return ${child(0, `safe_div3(p, ${v3(par.factor as number[])})`)} * ${f(par.scaleDistance as number)};`;
      case "rotate3": return `  return ${child(0, mat3Mul(par.matrix as number[][], "p"))};`;
      case "circularArray3": return `  float da = 2.0 * SDF_PI / ${f(par.count as number)};\n  float d = length(p.xy);\n  float a = imod(atan(p.y, p.x), da);\n  float offset = ${f(par.offset as number)};\n  return min(${child(0, "vec3(cos(a - da) * d - offset, sin(a - da) * d, p.z)")}, ${child(0, "vec3(cos(a) * d - offset, sin(a) * d, p.z)")});`;
      case "elongate3": return `  vec3 q = abs(p) - ${v3(par.size as number[])};\n  float w = min(max(q.x, max(q.y, q.z)), 0.0);\n  return ${child(0, "max(q, vec3(0.0))")} + w;`;
      case "twist": return `  float c = cos(${f(par.k as number)} * p.z);\n  float s = sin(${f(par.k as number)} * p.z);\n  return ${child(0, "vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z)")};`;
      case "bend": return `  float c = cos(${f(par.k as number)} * p.x);\n  float s = sin(${f(par.k as number)} * p.x);\n  return ${child(0, "vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z)")};`;
      case "bendLinear": return this.bendLinearBody(par, child);
      case "bendRadial": return this.bendRadialBody(par, child);
      case "transitionLinear": return this.transitionLinearBody(par, child);
      case "transitionRadial": return this.transitionRadialBody(par, child);
      case "wrapAround": return `  float d = length(p.xy) - ${f(par.r as number)};\n  float a = atan(p.y, p.x);\n  float t = ${easeCall(par.ease as EaseName, "(a + SDF_PI) / (2.0 * SDF_PI)")};\n  return ${child(0, `vec3(mix(${f(par.x0 as number)}, ${f(par.x1 as number)}, t), -d, p.z)`)};`;
      case "extrude": return `  float d = ${fnName(node.children[0].node)}(p.xy);\n  vec2 w = vec2(d, abs(p.z) - ${f((par.h as number) / 2)});\n  return min(max(w.x, w.y), 0.0) + length(max(w, vec2(0.0)));`;
      case "extrudeTo": return `  float d1 = ${fnName(node.children[0].node)}(p.xy);\n  float d2 = ${fnName(node.children[1].node)}(p.xy);\n  float t = ${easeCall(par.ease as EaseName, `clamp(p.z / ${f(par.h as number)}, -0.5, 0.5) + 0.5`)};\n  float d = mix(d1, d2, t);\n  vec2 w = vec2(d, abs(p.z) - ${f((par.h as number) / 2)});\n  return min(max(w.x, w.y), 0.0) + length(max(w, vec2(0.0)));`;
      case "revolve": return `  return ${fnName(node.children[0].node)}(vec2(length(p.xy) - ${f(par.offset as number)}, p.z));`;
      default: throw new Error(`unsupported GLSL 3D node: ${node.kind}`);
    }
  }

  private roundedRectangleBody(par: Record<string, unknown>): string {
    const radius = par.radius as number[];
    return `  vec2 q0 = p - ${v2(par.center as number[])};\n  float r = ${f(radius[2])};\n  if (q0.x > 0.0 && q0.y > 0.0) { r = ${f(radius[0])}; }\n  if (q0.x > 0.0 && q0.y <= 0.0) { r = ${f(radius[1])}; }\n  if (q0.x <= 0.0 && q0.y > 0.0) { r = ${f(radius[3])}; }\n  vec2 q = abs(q0) - ${v2((par.size as number[]).map((x) => x / 2))} + vec2(r);\n  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;`;
  }

  private polygonBody(points: number[][]): string {
    const lines = [`  float d = dot(p - ${v2(points[0])}, p - ${v2(points[0])});`, "  float s = 1.0;"];
    for (let i = 0; i < points.length; i += 1) {
      const j = (i + points.length - 1) % points.length;
      lines.push(`  { vec2 vi = ${v2(points[i])}; vec2 vj = ${v2(points[j])}; vec2 e = vj - vi; vec2 w = p - vi; vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0); d = min(d, dot(b, b)); bool c1 = p.y >= vi.y; bool c2 = p.y < vj.y; bool c3 = e.x * w.y > e.y * w.x; if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) { s = -s; } }`);
    }
    lines.push("  return s * sqrt(d);");
    return lines.join("\n");
  }

  private wireframeBoxBody(par: Record<string, unknown>): string {
    return `  vec3 size = ${v3(par.size as number[])};\n  float thickness = ${f(par.thickness as number)};\n  vec3 p0 = abs(p) - size / 2.0 - vec3(thickness / 2.0);\n  vec3 q = abs(p0 + vec3(thickness / 2.0)) - vec3(thickness / 2.0);\n  float a = length(max(vec3(p0.x, q.y, q.z), vec3(0.0))) + min(max(p0.x, max(q.y, q.z)), 0.0);\n  float b = length(max(vec3(q.x, p0.y, q.z), vec3(0.0))) + min(max(q.x, max(p0.y, q.z)), 0.0);\n  float c = length(max(vec3(q.x, q.y, p0.z), vec3(0.0))) + min(max(q.x, max(q.y, p0.z)), 0.0);\n  return min(min(a, b), c);`;
  }

  private cappedCylinderBody(par: Record<string, unknown>): string {
    return `  vec3 a = ${v3(par.a as number[])};\n  vec3 b = ${v3(par.b as number[])};\n  vec3 ba = b - a;\n  vec3 pa = p - a;\n  float baba = dot(ba, ba);\n  float paba = dot(pa, ba);\n  float x = length(pa * baba - ba * paba) - ${f(par.radius as number)} * baba;\n  float y = abs(paba - baba * 0.5) - baba * 0.5;\n  float d = max(x, y) < 0.0 ? -min(x * x, y * y * baba) : (x > 0.0 ? x * x : 0.0) + (y > 0.0 ? y * y * baba : 0.0);\n  return sgn(d) * sqrt(abs(d)) / baba;`;
  }

  private cappedConeBody(par: Record<string, unknown>): string {
    return `  vec3 a = ${v3(par.a as number[])};\n  vec3 b = ${v3(par.b as number[])};\n  vec3 ba = b - a;\n  vec3 pa = p - a;\n  float rba = ${f((par.rb as number) - (par.ra as number))};\n  float baba = dot(ba, ba);\n  float papa = dot(pa, pa);\n  float paba = dot(pa, ba) / baba;\n  float x = sqrt(max(0.0, papa - paba * paba * baba));\n  float cax = max(0.0, x - (paba < 0.5 ? ${f(par.ra as number)} : ${f(par.rb as number)}));\n  float cay = abs(paba - 0.5) - 0.5;\n  float k = rba * rba + baba;\n  float ff = clamp((rba * (x - ${f(par.ra as number)}) + paba * baba) / k, 0.0, 1.0);\n  float cbx = x - ${f(par.ra as number)} - ff * rba;\n  float cby = paba - ff;\n  float s = cbx < 0.0 && cay < 0.0 ? -1.0 : 1.0;\n  return s * sqrt(min(cax * cax + cay * cay * baba, cbx * cbx + cby * cby * baba));`;
  }

  private roundedConeBody(par: Record<string, unknown>): string {
    return `  vec2 q = vec2(length(p.xy), p.z);\n  float b = ${f(((par.r1 as number) - (par.r2 as number)) / (par.h as number))};\n  float a = sqrt(max(0.0, 1.0 - b * b));\n  float k = dot(q, vec2(-b, a));\n  float c1 = length(q) - ${f(par.r1 as number)};\n  float c2 = length(q - vec2(0.0, ${f(par.h as number)})) - ${f(par.r2 as number)};\n  float c3 = dot(q, vec2(a, b)) - ${f(par.r1 as number)};\n  return k < 0.0 ? c1 : k > a * ${f(par.h as number)} ? c2 : c3;`;
  }

  private pyramidBody(par: Record<string, unknown>): string {
    return `  vec2 a = abs(p.xy) - vec2(0.5);\n  if (a.y > a.x) { a = a.yx; }\n  float px = a.x;\n  float py = p.z;\n  float pz = a.y;\n  float h = ${f(par.h as number)};\n  float m2 = h * h + 0.25;\n  float qx = pz;\n  float qy = h * py - 0.5 * px;\n  float qz = h * px + 0.5 * py;\n  float s = max(-qx, 0.0);\n  float t = clamp((qy - 0.5 * pz) / (m2 + 0.25), 0.0, 1.0);\n  float da = m2 * (qx + s) * (qx + s) + qy * qy;\n  float db = m2 * (qx + 0.5 * t) * (qx + 0.5 * t) + (qy - m2 * t) * (qy - m2 * t);\n  float d2 = min(qy, -qx * m2 - qy * 0.5) > 0.0 ? 0.0 : min(da, db);\n  return sqrt((d2 + qz * qz) / m2) * sgn(max(qz, -py));`;
  }

  private dodecahedronBody(par: Record<string, unknown>): string {
    const n = normalize([(1 + Math.sqrt(5)) / 2, 1, 0]);
    return `  vec3 n = ${v3(n)};\n  vec3 q = abs(p / ${f(par.r as number)});\n  float a = dot(q, n.xyz);\n  float b = dot(q, n.zxy);\n  float c = dot(q, n.yzx);\n  return (max(max(a, b), c) - n.x) * ${f(par.r as number)};`;
  }

  private icosahedronBody(par: Record<string, unknown>): string {
    const r = (par.r as number) * 0.8506507174597755;
    const n = normalize([(Math.sqrt(5) + 3) / 2, 1, 0]);
    return `  vec3 n = ${v3(n)};\n  float w = sqrt(3.0) / 3.0;\n  vec3 q = abs(p / ${f(r)});\n  float a = dot(q, n.xyz);\n  float b = dot(q, n.zxy);\n  float c = dot(q, n.yzx);\n  float d = dot(q, vec3(w)) - n.x;\n  return max(max(max(a, b), c) - n.x, d) * ${f(r)};`;
  }

  private bendLinearBody(par: Record<string, unknown>, child: (i?: number, arg?: string) => string): string {
    return `  vec3 p0 = ${v3(par.p0 as number[])};\n  vec3 p1 = ${v3(par.p1 as number[])};\n  vec3 ab = p1 - p0;\n  float t = ${easeCall(par.ease as EaseName, "clamp(dot(p - p0, ab) / dot(ab, ab), 0.0, 1.0)")};\n  return ${child(0, `p + ${v3(par.v as number[])} * t`)};`;
  }

  private bendRadialBody(par: Record<string, unknown>, child: (i?: number, arg?: string) => string): string {
    return `  float r = length(p.xy);\n  float t = ${easeCall(par.ease as EaseName, `clamp((r - ${f(par.r0 as number)}) / ${f((par.r1 as number) - (par.r0 as number))}, 0.0, 1.0)`)};\n  return ${child(0, `vec3(p.xy, p.z - ${f(par.dz as number)} * t)`)};`;
  }

  private transitionLinearBody(par: Record<string, unknown>, child: (i?: number, arg?: string) => string): string {
    return `  vec3 p0 = ${v3(par.p0 as number[])};\n  vec3 p1 = ${v3(par.p1 as number[])};\n  vec3 ab = p1 - p0;\n  float t = ${easeCall(par.ease as EaseName, "clamp(dot(p - p0, ab) / dot(ab, ab), 0.0, 1.0)")};\n  return mix(${child(0)}, ${child(1)}, t);`;
  }

  private transitionRadialBody(par: Record<string, unknown>, child: (i?: number, arg?: string) => string): string {
    return `  float r = length(p.xy);\n  float t = ${easeCall(par.ease as EaseName, `clamp((r - ${f(par.r0 as number)}) / ${f((par.r1 as number) - (par.r0 as number))}, 0.0, 1.0)`)};\n  return mix(${child(0)}, ${child(1)}, t);`;
  }
}

function easeCall(name: EaseName, arg: string): string {
  return `ease_${name}(${arg})`;
}
