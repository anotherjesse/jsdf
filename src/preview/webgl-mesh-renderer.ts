import type { Node, SDF3 } from "../core/nodes";
import { compileGLSLScene } from "../glsl/compiler";
import type { Bounds3 } from "../mesh/bounds";
import type { Triangle } from "../mesh/polygonize";
import { HIGHLIGHT_GLSL_COLOR, HIGHLIGHT_PALETTE, highlightStyle, highlightStyleFromState, type HighlightMode } from "./highlight-style";
import type { OrbitCamera } from "./orbit-camera";
import { selectedSceneFunction } from "./selected-scene";
import { viewPanels, type PreviewLayout, type ViewPanel } from "./view-layout";

export class WebGLMeshRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private program: WebGLProgram | null = null;
  private currentSource = "";
  private programBuilds = 0;
  private highlightNodeId = -1;
  private highlightNodeKind = "";
  private highlightMode: HighlightMode = "mark";
  private vertexCount = 0;
  private bounds: Bounds3 | null = null;
  private center = [0, 0, 0];
  private radius = 1;
  private active = false;
  private layout: PreviewLayout = "single";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: OrbitCamera,
  ) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.redraw();
  }

  setLayout(layout: PreviewLayout): void {
    if (this.layout === layout) return;
    this.layout = layout;
    if (this.active) this.redraw();
  }

  render(
    triangles: Triangle[],
    bounds: Bounds3,
    sdf: SDF3 | null = null,
    highlightNode: Node | null = null,
    highlightMode: HighlightMode = "mark",
  ): void {
    this.upload(triangles);
    this.setBounds(bounds);
    this.setHighlight(sdf, highlightNode, highlightMode, { redraw: false });
    if (this.active) this.redraw();
  }

  setHighlight(
    sdf: SDF3 | null,
    highlightNode: Node | null,
    highlightMode: HighlightMode = "mark",
    options: { redraw?: boolean } = {},
  ): void {
    this.ensureProgram(sdf);
    this.highlightNodeId = highlightNode?.id ?? -1;
    this.highlightNodeKind = highlightNode?.kind ?? "";
    this.highlightMode = highlightNode ? highlightMode : "mark";
    this.canvas.dataset.highlightNode = highlightNode ? String(highlightNode.id) : "";
    this.canvas.dataset.highlightKind = this.highlightNodeKind;
    this.canvas.dataset.highlightMode = highlightNode ? highlightMode : "";
    this.canvas.dataset.highlightStyle = highlightStyle(highlightNode, highlightMode);
    this.canvas.dataset.highlightPalette = highlightNode ? HIGHLIGHT_PALETTE : "";
    if (options.redraw !== false && this.active) this.redraw();
  }

  redraw(): void {
    if (!this.active) return;
    if (!this.program || !this.bounds || this.vertexCount === 0) return;
    this.resize();
    const gl = this.gl;
    const panels = viewPanels(this.layout, this.canvas.width, this.canvas.height);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.11, 0.125, 0.145, 1);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform3f(gl.getUniformLocation(this.program, "u_light"), 0.45, 0.7, 0.9);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_highlightNode"), this.highlightNodeId);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_focusHighlight"), this.highlightMode === "focus" && this.highlightNodeId >= 0 ? 1 : 0);
    gl.bindVertexArray(this.vao);
    for (const panel of panels) {
      this.drawPanel(panel);
    }
    this.recordPixelDiagnostics();
    gl.bindVertexArray(null);
  }

  private drawPanel(panel: ViewPanel): void {
    if (!this.program) return;
    const aspect = panel.width / panel.height;
    const eye = panel.direction
      ? this.camera.eyeForDirection(this.center, this.radius, panel.direction)
      : this.camera.eye(this.center, this.radius);
    const up = panel.direction && Math.abs(panel.direction[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
    const view = lookAt(eye, this.center, up);
    const projection = perspective(this.layout === "quad" ? Math.PI / 4 : Math.PI / 5, aspect, 0.01, this.radius * 60 + 10);
    const mvp = multiplyMat4(projection, view);
    this.gl.viewport(panel.x, panel.y, panel.width, panel.height);
    this.gl.uniformMatrix4fv(this.gl.getUniformLocation(this.program, "u_mvp"), false, mvp);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertexCount);
  }

  private ensureProgram(sdf: SDF3 | null): void {
    const source = fragmentShader(sdf);
    if (source === this.currentSource) return;
    this.program = createProgram(this.gl, vertexShader, source);
    this.currentSource = source;
    this.programBuilds += 1;
  }

  private resize(): void {
    const dpr = Math.min(1.25, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private setBounds(bounds: Bounds3): void {
    this.bounds = bounds;
    this.center = [
      (bounds[0][0] + bounds[1][0]) / 2,
      (bounds[0][1] + bounds[1][1]) / 2,
      (bounds[0][2] + bounds[1][2]) / 2,
    ];
    this.radius = Math.max(
      bounds[1][0] - bounds[0][0],
      bounds[1][1] - bounds[0][1],
      bounds[1][2] - bounds[0][2],
    ) * 0.62 || 1;
  }

  private upload(triangles: Triangle[]): void {
    const data = new Float32Array(triangles.length * 18);
    let offset = 0;
    for (const tri of triangles) {
      const n = normal(tri);
      for (const p of tri) {
        data.set(p, offset);
        data.set(n, offset + 3);
        offset += 6;
      }
    }
    this.vertexCount = triangles.length * 3;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
  }

  private recordPixelDiagnostics(): void {
    const pixel = new Uint8Array(4);
    const points = [
      [0.5, 0.5],
      [0.35, 0.5],
      [0.65, 0.5],
      [0.5, 0.35],
      [0.5, 0.65],
    ];
    let sum = 0;
    let min = 255;
    let max = 0;
    const distinct = new Set<string>();
    for (const [px, py] of points) {
      const x = Math.max(0, Math.min(this.canvas.width - 1, Math.floor(px * this.canvas.width)));
      const y = Math.max(0, Math.min(this.canvas.height - 1, Math.floor(py * this.canvas.height)));
      this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
      sum += pixel[0] + pixel[1] + pixel[2];
      min = Math.min(min, pixel[0], pixel[1], pixel[2]);
      max = Math.max(max, pixel[0], pixel[1], pixel[2]);
      distinct.add(`${pixel[0]},${pixel[1]},${pixel[2]}`);
    }
    this.canvas.dataset.previewMode = "mesh";
    this.canvas.dataset.previewLayout = this.layout;
    this.canvas.dataset.previewWidth = String(this.canvas.width);
    this.canvas.dataset.previewHeight = String(this.canvas.height);
    this.canvas.dataset.previewSum = String(sum);
    this.canvas.dataset.previewMin = String(min);
    this.canvas.dataset.previewMax = String(max);
    this.canvas.dataset.previewDistinct = String(distinct.size);
    this.canvas.dataset.programBuilds = String(this.programBuilds);
    this.canvas.dataset.highlightNode = this.highlightNodeId >= 0 ? String(this.highlightNodeId) : "";
    this.canvas.dataset.highlightKind = this.highlightNodeKind;
    this.canvas.dataset.highlightMode = this.highlightNodeId >= 0 ? this.highlightMode : "";
    this.canvas.dataset.highlightStyle = highlightStyleFromState(this.highlightNodeId, this.highlightMode);
    this.canvas.dataset.highlightPalette = this.highlightNodeId >= 0 ? HIGHLIGHT_PALETTE : "";
    delete this.canvas.dataset.previewSteps;
  }
}

function normal(triangle: Triangle): number[] {
  const [a, b, c] = triangle;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "a_position");
  gl.bindAttribLocation(program, 1, "a_normal");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Could not link WebGL program.");
  }
  return program;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Could not compile WebGL shader.");
  }
  return shader;
}

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function normalize(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

const vertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
uniform mat4 u_mvp;
out vec3 v_normal;
out vec3 v_position;
void main() {
  v_normal = normalize(a_normal);
  v_position = a_position;
  gl_Position = u_mvp * vec4(a_position, 1.0);
}
`;

function fragmentShader(sdf: SDF3 | null): string {
  const sceneSource = sdf
    ? compileGLSLScene(sdf).source
    : "vec3 sceneColor(vec3 p) { return vec3(0.16, 0.72, 0.66); }";
  const selectedScene = sdf
    ? selectedSceneFunction(sdf.node)
    : [
      "float selectedScene(vec3 p) {",
      "  return 1000000000.0;",
      "}",
    ].join("\n");
  return `#version 300 es
precision highp float;
${sceneSource}

in vec3 v_normal;
in vec3 v_position;
uniform vec3 u_light;
uniform int u_highlightNode;
uniform int u_focusHighlight;
${selectedScene}
const vec3 highlightColor = ${HIGHLIGHT_GLSL_COLOR};

out vec4 outColor;
void main() {
  vec3 n = normalize(v_normal);
  vec3 light = normalize(u_light);
  float diffuse = max(dot(n, light), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.6, -0.3, 0.55))), 0.0);
  float rim = pow(1.0 - abs(n.z) * 0.55, 2.0) * 0.18;
  vec3 base = sceneColor(v_position);
  vec3 warm = vec3(0.95, 0.64, 0.16);
  vec3 color = base * (0.34 + diffuse * 0.75) + warm * fill * 0.16 + vec3(rim);
  float selectedBand = 1.0 - smoothstep(0.006, 0.055, abs(selectedScene(v_position)));
  if (u_focusHighlight == 1) {
    vec3 faded = mix(vec3(0.11, 0.125, 0.145), color, 0.26);
    color = mix(faded, color, selectedBand);
    color = mix(color, highlightColor, selectedBand * 0.32);
  } else {
    color = mix(color, highlightColor, selectedBand * 0.40);
  }
  outColor = vec4(pow(color, vec3(0.4545)), 1.0);
}
`;
}
