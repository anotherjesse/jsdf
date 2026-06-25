const vertexShader = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

out vec2 v_uv;

void main() {
  vec2 p = POSITIONS[gl_VertexID];
  v_uv = p;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const fragmentShader = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform vec3 u_eye;
uniform vec3 u_target;
uniform int u_steps;

in vec2 v_uv;
out vec4 outColor;

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float scene(vec3 p) {
  return sdBox(p, vec3(0.85));
}

vec3 estimateNormal(vec3 p) {
  float e = 0.0015;
  return normalize(vec3(
    scene(p + vec3(e, 0.0, 0.0)) - scene(p - vec3(e, 0.0, 0.0)),
    scene(p + vec3(0.0, e, 0.0)) - scene(p - vec3(0.0, e, 0.0)),
    scene(p + vec3(0.0, 0.0, e)) - scene(p - vec3(0.0, 0.0, e))
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;

  vec3 forward = normalize(u_target - u_eye);
  vec3 right = normalize(cross(forward, vec3(0.0, 0.0, 1.0)));
  vec3 up = normalize(cross(right, forward));
  vec3 ray = normalize(forward + uv.x * right * 0.62 + uv.y * up * 0.62);

  float t = 0.0;
  bool hit = false;
  vec3 p = u_eye;
  for (int i = 0; i < 320; i++) {
    if (i >= u_steps) { break; }
    p = u_eye + ray * t;
    float d = scene(p);
    if (abs(d) < 0.001) {
      hit = true;
      break;
    }
    t += max(d * 0.85, 0.002);
    if (t > 30.0) { break; }
  }

  vec3 bg = vec3(0.10, 0.12, 0.15) + vec3(0.045 * uv.y);
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
  vec3 color = vec3(0.14, 0.70, 0.65) * (0.28 + diffuse * 0.86)
    + vec3(0.95, 0.63, 0.16) * soft * 0.18
    + vec3(0.55, 0.72, 0.85) * rim * 0.35;

  outColor = vec4(pow(color, vec3(0.4545)), 1.0);
}
`;

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const badge = document.querySelector<HTMLElement>("#badge")!;
const context = canvas.getContext("webgl2", { antialias: false, alpha: false });

if (!context) {
  badge.textContent = "WebGL2 unavailable";
  throw new Error("WebGL2 is not available.");
}

const gl = context;
const program = createProgram(gl, vertexShader, fragmentShader);
const vao = gl.createVertexArray();
const uniforms = {
  resolution: gl.getUniformLocation(program, "u_resolution"),
  eye: gl.getUniformLocation(program, "u_eye"),
  target: gl.getUniformLocation(program, "u_target"),
  steps: gl.getUniformLocation(program, "u_steps"),
};

let azimuth = 0.78;
let elevation = 0.42;
let distance = 4.2;
let dragging = false;
let last = [0, 0];

canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  last = [event.clientX, event.clientY];
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - last[0];
  const dy = event.clientY - last[1];
  last = [event.clientX, event.clientY];
  azimuth -= dx * 0.008;
  elevation = clamp(elevation + dy * 0.008, -1.35, 1.35);
  draw();
});

canvas.addEventListener("pointerup", (event) => {
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", () => {
  dragging = false;
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  distance = clamp(distance * Math.exp(event.deltaY * 0.001), 2.0, 9.0);
  draw();
}, { passive: false });

window.addEventListener("resize", draw);
draw();

function draw(): void {
  resize();
  const start = performance.now();
  const orbit = [
    Math.cos(elevation) * Math.cos(azimuth),
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
  ];
  const eye = orbit.map((v) => v * distance);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
  gl.uniform3f(uniforms.eye, eye[0], eye[1], eye[2]);
  gl.uniform3f(uniforms.target, 0, 0, 0);
  gl.uniform1i(uniforms.steps, 160);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  badge.textContent = `WebGL2 raymarch cube | ${Math.max(0, performance.now() - start).toFixed(2)} ms`;
}

function resize(): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
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
    throw new Error(gl.getProgramInfoLog(program) || "Could not link shader program.");
  }
  return program;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Could not compile shader.");
  }
  return shader;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}
