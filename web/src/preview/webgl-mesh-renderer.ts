import type { Bounds3 } from "../mesh/bounds";
import type { Triangle } from "../mesh/polygonize";

export class WebGLMeshRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly mvpLocation: WebGLUniformLocation;
  private readonly lightLocation: WebGLUniformLocation;
  private vertexCount = 0;
  private bounds: Bounds3 | null = null;
  private center = [0, 0, 0];
  private radius = 1;
  private azimuth = 0.83;
  private elevation = 0.47;
  private distance = 3.65;
  private dragging = false;
  private lastPointer = [0, 0];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    this.program = createProgram(gl, vertexShader, fragmentShader);
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    this.mvpLocation = gl.getUniformLocation(this.program, "u_mvp")!;
    this.lightLocation = gl.getUniformLocation(this.program, "u_light")!;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
    this.attachControls();
  }

  render(triangles: Triangle[], bounds: Bounds3): void {
    this.upload(triangles);
    this.setBounds(bounds);
    this.redraw();
  }

  redraw(): void {
    if (!this.bounds || this.vertexCount === 0) return;
    this.resize();
    const gl = this.gl;
    const aspect = this.canvas.width / this.canvas.height;
    const orbit = [
      Math.cos(this.elevation) * Math.cos(this.azimuth),
      Math.cos(this.elevation) * Math.sin(this.azimuth),
      Math.sin(this.elevation),
    ];
    const eye = [
      this.center[0] + orbit[0] * this.radius * this.distance,
      this.center[1] + orbit[1] * this.radius * this.distance,
      this.center[2] + orbit[2] * this.radius * this.distance,
    ];
    const view = lookAt(eye, this.center, [0, 0, 1]);
    const projection = perspective(Math.PI / 5, aspect, 0.01, this.radius * this.distance * 6 + 10);
    const mvp = multiplyMat4(projection, view);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.11, 0.125, 0.145, 1);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.mvpLocation, false, mvp);
    gl.uniform3f(this.lightLocation, 0.45, 0.7, 0.9);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }

  private resize(): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
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

  private attachControls(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.lastPointer = [event.clientX, event.clientY];
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastPointer[0];
      const dy = event.clientY - this.lastPointer[1];
      this.lastPointer = [event.clientX, event.clientY];
      this.azimuth -= dx * 0.007;
      this.elevation = clamp(this.elevation + dy * 0.007, -1.35, 1.35);
      this.redraw();
    });
    this.canvas.addEventListener("pointerup", (event) => {
      this.dragging = false;
      this.canvas.releasePointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.dragging = false;
    });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.distance = clamp(this.distance * Math.exp(event.deltaY * 0.001), 1.45, 9);
      this.redraw();
    }, { passive: false });
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

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
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

const fragmentShader = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_position;
uniform vec3 u_light;
out vec4 outColor;
void main() {
  vec3 n = normalize(v_normal);
  vec3 light = normalize(u_light);
  float diffuse = max(dot(n, light), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.6, -0.3, 0.55))), 0.0);
  float rim = pow(1.0 - abs(n.z) * 0.55, 2.0) * 0.18;
  vec3 base = vec3(0.16, 0.72, 0.66);
  vec3 warm = vec3(0.95, 0.64, 0.16);
  vec3 color = base * (0.34 + diffuse * 0.75) + warm * fill * 0.16 + vec3(rim);
  outColor = vec4(pow(color, vec3(0.4545)), 1.0);
}
`;
