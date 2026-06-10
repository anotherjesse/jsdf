import type { Triangle } from "./polygonize";

function normal(triangle: Triangle): number[] {
  const [a, b, c] = triangle;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

export function binarySTL(triangles: Triangle[], name = "sdf-browser"): Blob {
  const bytes = 84 + triangles.length * 50;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(name.slice(0, 80));
  new Uint8Array(buffer, 0, header.length).set(header);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const tri of triangles) {
    const n = normal(tri);
    for (const value of n) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    for (const point of tri) {
      for (const value of point) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "model/stl" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

