export interface GPUContext {
  adapter: GPUAdapter;
  device: GPUDevice;
}

let cached: Promise<GPUContext> | null = null;

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function getGPU(): Promise<GPUContext> {
  if (!cached) {
    cached = (async () => {
      if (!hasWebGPU()) throw new Error("WebGPU is not available in this browser.");
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) throw new Error("No WebGPU adapter was found.");
      const device = await adapter.requestDevice();
      return { adapter, device };
    })();
  }
  return cached;
}

export function writeBuffer(device: GPUDevice, buffer: GPUBuffer, data: ArrayBuffer | ArrayBufferView): void {
  device.queue.writeBuffer(buffer, 0, data instanceof ArrayBuffer ? data : data.buffer, data instanceof ArrayBuffer ? 0 : data.byteOffset, data instanceof ArrayBuffer ? data.byteLength : data.byteLength);
}

