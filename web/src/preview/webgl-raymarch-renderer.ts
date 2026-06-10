import type { Node, SDF3 } from "../core/nodes";
import type { Bounds3 } from "../mesh/bounds";
import { compileGLSLScene } from "../glsl/compiler";
import { HIGHLIGHT_GLSL_COLOR, HIGHLIGHT_PALETTE, highlightStyle, highlightStyleFromState, type HighlightMode } from "./highlight-style";
import type { OrbitCamera } from "./orbit-camera";
import { selectedSceneFunction } from "./selected-scene";
import { viewPanels, type PreviewLayout, type ViewPanel } from "./view-layout";

export class WebGLRaymarchRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private program: WebGLProgram | null = null;
  private currentSource = "";
  private bounds: Bounds3 | null = null;
  private center = [0, 0, 0];
  private radius = 1;
  private steps = 180;
  private programBuilds = 0;
  private highlightNodeId = -1;
  private highlightNodeKind = "";
  private highlightMode: HighlightMode = "mark";
  private active = true;
  private layout: PreviewLayout = "single";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: OrbitCamera,
  ) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
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
    sdf: SDF3,
    bounds: Bounds3,
    steps: number,
    highlightNode: Node | null = null,
    highlightMode: HighlightMode = "mark",
  ): void {
    const sceneSource = compileGLSLScene(sdf).source;
    const fragment = fragmentShader(sceneSource, sdf);
    if (fragment !== this.currentSource) {
      this.currentSource = fragment;
      this.program = createProgram(this.gl, vertexShader, fragment);
      this.programBuilds += 1;
    }
    this.steps = steps;
    this.highlightNodeId = highlightNode?.id ?? -1;
    this.highlightNodeKind = highlightNode?.kind ?? "";
    this.highlightMode = highlightNode ? highlightMode : "mark";
    this.canvas.dataset.highlightNode = highlightNode ? String(highlightNode.id) : "";
    this.canvas.dataset.highlightKind = this.highlightNodeKind;
    this.canvas.dataset.highlightMode = highlightNode ? highlightMode : "";
    this.canvas.dataset.highlightStyle = highlightStyle(highlightNode, highlightMode);
    this.canvas.dataset.highlightPalette = highlightNode ? HIGHLIGHT_PALETTE : "";
    this.canvas.dataset.previewLayout = this.layout;
    this.setBounds(bounds);
    if (this.active) this.redraw();
  }

  redraw(): void {
    if (!this.active) return;
    if (!this.program || !this.bounds) return;
    this.resize();
    const gl = this.gl;
    const panels = viewPanels(this.layout, this.canvas.width, this.canvas.height);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.105, 0.12, 0.145, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform3f(gl.getUniformLocation(this.program, "u_target"), this.center[0], this.center[1], this.center[2]);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_radius"), this.radius);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_viewScale"), this.layout === "quad" ? 0.82 : 0.62);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_steps"), this.steps);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_highlightNode"), this.highlightNodeId);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_focusHighlight"), this.highlightMode === "focus" && this.highlightNodeId >= 0 ? 1 : 0);
    for (const panel of panels) {
      this.drawPanel(panel);
    }
    this.recordPixelDiagnostics();
    gl.bindVertexArray(null);
  }

  private drawPanel(panel: ViewPanel): void {
    if (!this.program) return;
    const gl = this.gl;
    const eye = panel.direction
      ? this.camera.eyeForDirection(this.center, this.radius, panel.direction)
      : this.camera.eye(this.center, this.radius);
    gl.viewport(panel.x, panel.y, panel.width, panel.height);
    gl.uniform2f(gl.getUniformLocation(this.program, "u_resolution"), panel.width, panel.height);
    gl.uniform2f(gl.getUniformLocation(this.program, "u_viewOrigin"), panel.x, panel.y);
    gl.uniform3f(gl.getUniformLocation(this.program, "u_eye"), eye[0], eye[1], eye[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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

  private resize(): void {
    const dpr = Math.min(1.25, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private recordPixelDiagnostics(): void {
    const gl = this.gl;
    const pixel = new Uint8Array(4);
    const points = [
      [0.5, 0.5],
      [0.35, 0.5],
      [0.65, 0.5],
      [0.5, 0.35],
      [0.5, 0.65],
      [0.25, 0.25],
      [0.75, 0.75],
    ];
    let sum = 0;
    let min = 255;
    let max = 0;
    const distinct = new Set<string>();
    for (const [px, py] of points) {
      const x = Math.max(0, Math.min(this.canvas.width - 1, Math.floor(px * this.canvas.width)));
      const y = Math.max(0, Math.min(this.canvas.height - 1, Math.floor(py * this.canvas.height)));
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      sum += pixel[0] + pixel[1] + pixel[2];
      min = Math.min(min, pixel[0], pixel[1], pixel[2]);
      max = Math.max(max, pixel[0], pixel[1], pixel[2]);
      distinct.add(`${pixel[0]},${pixel[1]},${pixel[2]}`);
    }
    this.canvas.dataset.previewMode = "glsl-raymarch";
    this.canvas.dataset.previewLayout = this.layout;
    this.canvas.dataset.previewWidth = String(this.canvas.width);
    this.canvas.dataset.previewHeight = String(this.canvas.height);
    this.canvas.dataset.previewSum = String(sum);
    this.canvas.dataset.previewMin = String(min);
    this.canvas.dataset.previewMax = String(max);
    this.canvas.dataset.previewDistinct = String(distinct.size);
    this.canvas.dataset.previewSteps = String(this.steps);
    this.canvas.dataset.programBuilds = String(this.programBuilds);
    this.canvas.dataset.highlightKind = this.highlightNodeKind;
    this.canvas.dataset.highlightStyle = highlightStyleFromState(this.highlightNodeId, this.highlightMode);
    this.canvas.dataset.highlightPalette = this.highlightNodeId >= 0 ? HIGHLIGHT_PALETTE : "";
  }
}

function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Could not link GLSL raymarch program.";
    throw new Error(message);
  }
  return program;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Could not compile GLSL raymarch shader.";
    throw new Error(message);
  }
  return shader;
}

const vertexShader = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

void main() {
  gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
}
`;

function fragmentShader(sceneSource: string, sdf: SDF3): string {
  return `#version 300 es
${sceneSource}

uniform vec2 u_resolution;
uniform vec2 u_viewOrigin;
uniform vec3 u_eye;
uniform vec3 u_target;
uniform float u_radius;
uniform float u_viewScale;
uniform int u_steps;
uniform int u_highlightNode;
uniform int u_focusHighlight;

${selectedSceneFunction(sdf.node)}
const vec3 highlightColor = ${HIGHLIGHT_GLSL_COLOR};

out vec4 outColor;

vec3 estimateNormal(vec3 p) {
  float e = max(u_radius * 0.00045, 0.0008);
  return normalize(vec3(
    scene(p + vec3(e, 0.0, 0.0)) - scene(p - vec3(e, 0.0, 0.0)),
    scene(p + vec3(0.0, e, 0.0)) - scene(p - vec3(0.0, e, 0.0)),
    scene(p + vec3(0.0, 0.0, e)) - scene(p - vec3(0.0, 0.0, e))
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - u_viewOrigin) / u_resolution * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;

  vec3 forward = normalize(u_target - u_eye);
  vec3 rightSeed = cross(forward, vec3(0.0, 0.0, 1.0));
  if (length(rightSeed) < 0.001) {
    rightSeed = vec3(1.0, 0.0, 0.0);
  }
  vec3 right = normalize(rightSeed);
  vec3 up = normalize(cross(right, forward));
  vec3 ray = normalize(forward + uv.x * right * u_viewScale + uv.y * up * u_viewScale);

  float t = 0.0;
  float prevT = 0.0;
  float prevD = scene(u_eye);
  bool hit = false;
  vec3 p = u_eye;
  float eps = max(u_radius * 0.0006, 0.001);
  float maxDistance = max(u_radius * 12.0, 20.0);
  for (int i = 0; i < 384; i++) {
    if (i >= u_steps) { break; }
    p = u_eye + ray * t;
    float d = scene(p);
    if (abs(d) < eps) {
      hit = true;
      break;
    }
    if (i > 0 && ((d < 0.0) != (prevD < 0.0))) {
      float lo = prevT;
      float hi = t;
      float loD = prevD;
      for (int j = 0; j < 8; j++) {
        float mid = (lo + hi) * 0.5;
        float midD = scene(u_eye + ray * mid);
        if ((midD < 0.0) == (loD < 0.0)) {
          lo = mid;
          loD = midD;
        } else {
          hi = mid;
        }
      }
      t = (lo + hi) * 0.5;
      p = u_eye + ray * t;
      hit = true;
      break;
    }
    prevT = t;
    prevD = d;
    t += clamp(abs(d) * 0.48, eps * 0.35, u_radius * 0.10);
    if (t > maxDistance) { break; }
  }

  vec3 bg = vec3(0.105, 0.12, 0.145) + vec3(0.045 * uv.y);
  if (!hit) {
    outColor = vec4(bg, 1.0);
    return;
  }

  vec3 n = estimateNormal(p);
  vec3 light = normalize(vec3(0.45, 0.65, 0.85));
  vec3 fill = normalize(vec3(-0.65, -0.35, 0.5));
  float diffuse = max(dot(n, light), 0.0);
  float soft = max(dot(n, fill), 0.0);
  float rim = pow(max(0.0, 1.0 - dot(n, -ray)), 2.0);
  vec3 color = vec3(0.14, 0.70, 0.65) * (0.26 + diffuse * 0.88)
    + vec3(0.95, 0.63, 0.16) * soft * 0.16
    + vec3(0.55, 0.72, 0.85) * rim * 0.32;
  float selectedBand = 1.0 - smoothstep(eps * 3.0, eps * 14.0, abs(selectedScene(p)));
  if (u_focusHighlight == 1) {
    vec3 faded = mix(bg, color, 0.18);
    color = mix(faded, color, selectedBand);
    color = mix(color, highlightColor, selectedBand * 0.32);
  } else {
    color = mix(color, highlightColor, selectedBand * 0.40);
  }

  outColor = vec4(pow(color, vec3(0.4545)), 1.0);
}
`;
}
