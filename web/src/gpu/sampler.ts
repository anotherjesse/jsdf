import type { SDF3 } from "../core/nodes";
import { compileScene } from "../wgsl/compiler";
import { getGPU, writeBuffer } from "./webgpu";

export interface VolumeSample {
  values: Float32Array;
  dims: [number, number, number];
  bounds: [number[], number[]];
  step: [number, number, number];
  gpuTimeMs: number;
}

export async function sampleFieldWebGPU(sdf: SDF3, dims: [number, number, number], bounds: [number[], number[]]): Promise<VolumeSample> {
  const { device } = await getGPU();
  const total = dims[0] * dims[1] * dims[2];
  const values = device.createBuffer({ size: total * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: total * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const min = bounds[0];
  const max = bounds[1];
  const step: [number, number, number] = [
    (max[0] - min[0]) / (dims[0] - 1),
    (max[1] - min[1]) / (dims[1] - 1),
    (max[2] - min[2]) / (dims[2] - 1),
  ];

  const uniform = new ArrayBuffer(48);
  const u32 = new Uint32Array(uniform, 0, 4);
  const f32 = new Float32Array(uniform);
  u32.set([dims[0], dims[1], dims[2], total], 0);
  f32.set([min[0], min[1], min[2], 0], 4);
  f32.set([step[0], step[1], step[2], 0], 8);
  writeBuffer(device, params, uniform);

  const shader = computeShader(compileScene(sdf).source);
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "cs_main" } });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: values } },
      { binding: 1, resource: { buffer: params } },
    ],
  });

  const start = performance.now();
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(total / 64));
  pass.end();
  encoder.copyBufferToBuffer(values, 0, readback, 0, total * 4);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  return { values: out, dims, bounds, step, gpuTimeMs: performance.now() - start };
}

function computeShader(sceneSource: string): string {
  return /* wgsl */`
${sceneSource}

struct SampleParams {
  dims: vec4u,
  minPoint: vec4f,
  step: vec4f,
};

@group(0) @binding(0) var<storage, read_write> values: array<f32>;
@group(0) @binding(1) var<uniform> params: SampleParams;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  let total = params.dims.w;
  if (idx >= total) { return; }
  let nx = params.dims.x;
  let ny = params.dims.y;
  let ix = idx % nx;
  let iy = (idx / nx) % ny;
  let iz = idx / (nx * ny);
  let p = params.minPoint.xyz + vec3f(f32(ix), f32(iy), f32(iz)) * params.step.xyz;
  values[idx] = scene(p);
}
`;
}
