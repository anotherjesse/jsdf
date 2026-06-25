import type { SDF3 } from "../core/nodes";
import { compileScene } from "../wgsl/compiler";
import { getGPU, writeBuffer, type GPUContext } from "./webgpu";

export interface RenderOptions {
  steps: number;
  time?: number;
}

export class WebGPURenderer {
  private context: GPUCanvasContext | null = null;
  private gpu: GPUContext | null = null;
  private format: GPUTextureFormat = "bgra8unorm";
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private currentSource = "";

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async init(): Promise<void> {
    this.gpu = await getGPU();
    const context = this.canvas.getContext("webgpu");
    if (!context) throw new Error("Could not create a WebGPU canvas context.");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.configure();
  }

  get device(): GPUDevice {
    if (!this.gpu) throw new Error("renderer is not initialized");
    return this.gpu.device;
  }

  resize(): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.configure();
    }
  }

  async render(sdf: SDF3, options: RenderOptions): Promise<void> {
    if (!this.gpu || !this.context) await this.init();
    this.resize();
    const source = renderShader(compileScene(sdf).source);
    if (!this.pipeline || source !== this.currentSource) {
      this.currentSource = source;
      this.pipeline = this.createPipeline(source);
      this.uniformBuffer = this.device.createBuffer({
        size: 16 * 5,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }

    const uniforms = new Float32Array(20);
    uniforms.set([this.canvas.width, this.canvas.height, options.time ?? performance.now() / 1000, options.steps], 0);
    uniforms.set([4.5, 4.5, 3.4, 0], 4);
    uniforms.set([0, 0, 0, 0], 8);
    uniforms.set([0, 0, 1, 0], 12);
    uniforms.set([0.7, 40, 0.004, 0], 16);
    writeBuffer(this.device, this.uniformBuffer!, uniforms);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer! } }],
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context!.getCurrentTexture().createView(),
        clearValue: { r: 0.1, g: 0.11, b: 0.12, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private configure(): void {
    if (!this.context || !this.gpu) return;
    this.context.configure({
      device: this.gpu.device,
      format: this.format,
      alphaMode: "opaque",
    });
  }

  private createPipeline(source: string): GPURenderPipeline {
    const module = this.device.createShaderModule({ code: source });
    return this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_main", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });
  }
}

function renderShader(sceneSource: string): string {
  return /* wgsl */`
${sceneSource}

struct RenderUniforms {
  resolution: vec2f,
  time: f32,
  steps: f32,
  eye: vec4f,
  target: vec4f,
  up: vec4f,
  params: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: RenderUniforms;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  let pos = positions[vertexIndex];
  var out: VertexOut;
  out.position = vec4f(pos, 0.0, 1.0);
  out.uv = pos;
  return out;
}

fn estimate_normal(p: vec3f) -> vec3f {
  let e = uniforms.params.z;
  let x = scene(p + vec3f(e, 0.0, 0.0)) - scene(p - vec3f(e, 0.0, 0.0));
  let y = scene(p + vec3f(0.0, e, 0.0)) - scene(p - vec3f(0.0, e, 0.0));
  let z = scene(p + vec3f(0.0, 0.0, e)) - scene(p - vec3f(0.0, 0.0, e));
  return normalize(vec3f(x, y, z));
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let resolution = uniforms.resolution;
  var uv = (fragCoord.xy / resolution) * 2.0 - vec2f(1.0);
  uv.x *= resolution.x / resolution.y;

  let eye = uniforms.eye.xyz;
  let target = uniforms.target.xyz;
  let worldUp = uniforms.up.xyz;
  let forward = normalize(target - eye);
  let right = normalize(cross(forward, worldUp));
  let up = normalize(cross(right, forward));
  let ray = normalize(forward + uv.x * right * uniforms.params.x + uv.y * up * uniforms.params.x);

  var t = 0.0;
  var hit = false;
  let maxSteps = i32(uniforms.steps);
  for (var i = 0; i < 256; i = i + 1) {
    if (i >= maxSteps) { break; }
    let p = eye + ray * t;
    let d = scene(p);
    if (abs(d) < uniforms.params.z) {
      hit = true;
      break;
    }
    t += clamp(abs(d) * 0.55, 0.002, 0.08);
    if (t > uniforms.params.y) { break; }
  }

  let grid = 0.018 * (step(0.985, cos((uv.x + uv.y) * 18.0)) + step(0.985, cos((uv.x - uv.y) * 18.0)));
  let bg = vec3f(0.11, 0.125, 0.145) + 0.08 * vec3f(uv.y + 0.5) + vec3f(grid);
  if (!hit) { return vec4f(bg, 1.0); }

  let pos = eye + ray * t;
  let n = estimate_normal(pos);
  let light = normalize(vec3f(0.5, 0.7, 0.9));
  let fill = normalize(vec3f(-0.65, -0.35, 0.45));
  let diffuse = max(dot(n, light), 0.0);
  let rim = pow(max(0.0, 1.0 - dot(n, -ray)), 2.0);
  let color = vec3f(0.15, 0.68, 0.63) * (0.28 + diffuse * 0.78) + vec3f(0.95, 0.65, 0.18) * max(dot(n, fill), 0.0) * 0.16 + rim * vec3f(0.6, 0.8, 0.9);
  return vec4f(pow(color, vec3f(0.4545)), 1.0);
}
`;
}
