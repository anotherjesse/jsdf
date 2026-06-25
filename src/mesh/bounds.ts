import type { SDF3 } from "../core/nodes";
import { evaluate3 } from "../evaluate";
import { length } from "../core/math";

export type Bounds3 = [number[], number[]];

export function estimateBounds(sdf: SDF3, options: { initial?: number; samples?: number; iterations?: number } = {}): Bounds3 {
  const initial = options.initial ?? 32;
  const samples = options.samples ?? 12;
  const iterations = options.iterations ?? 10;
  let lo = [-initial, -initial, -initial];
  let hi = [initial, initial, initial];
  let found = false;

  for (let iter = 0; iter < iterations; iter += 1) {
    const step = [
      (hi[0] - lo[0]) / (samples - 1),
      (hi[1] - lo[1]) / (samples - 1),
      (hi[2] - lo[2]) / (samples - 1),
    ];
    const threshold = length(step) * 0.85;
    const nextLo = [Infinity, Infinity, Infinity];
    const nextHi = [-Infinity, -Infinity, -Infinity];

    for (let ix = 0; ix < samples; ix += 1) {
      for (let iy = 0; iy < samples; iy += 1) {
        for (let iz = 0; iz < samples; iz += 1) {
          const p = [lo[0] + ix * step[0], lo[1] + iy * step[1], lo[2] + iz * step[2]];
          if (Math.abs(evaluate3(sdf, p)) <= threshold) {
            found = true;
            for (let axis = 0; axis < 3; axis += 1) {
              nextLo[axis] = Math.min(nextLo[axis], p[axis] - step[axis]);
              nextHi[axis] = Math.max(nextHi[axis], p[axis] + step[axis]);
            }
          }
        }
      }
    }

    if (!Number.isFinite(nextLo[0])) break;
    lo = nextLo;
    hi = nextHi;
  }

  return found ? [lo, hi] : [[-initial, -initial, -initial], [initial, initial, initial]];
}

export function paddedBounds(bounds: Bounds3, ratio = 0.08): Bounds3 {
  const lo = [...bounds[0]];
  const hi = [...bounds[1]];
  for (let i = 0; i < 3; i += 1) {
    const pad = Math.max(0.001, (hi[i] - lo[i]) * ratio);
    lo[i] -= pad;
    hi[i] += pad;
  }
  return [lo, hi];
}
