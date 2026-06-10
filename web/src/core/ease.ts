export type EaseName =
  | "linear"
  | "in_quad" | "out_quad" | "in_out_quad"
  | "in_cubic" | "out_cubic" | "in_out_cubic"
  | "in_quart" | "out_quart" | "in_out_quart"
  | "in_quint" | "out_quint" | "in_out_quint"
  | "in_sine" | "out_sine" | "in_out_sine"
  | "in_expo" | "out_expo" | "in_out_expo"
  | "in_circ" | "out_circ" | "in_out_circ"
  | "in_elastic" | "out_elastic" | "in_out_elastic"
  | "in_back" | "out_back" | "in_out_back"
  | "in_bounce" | "out_bounce" | "in_out_bounce"
  | "in_square" | "out_square" | "in_out_square";

export type EaseFn = ((t: number) => number) & { easeId: EaseName };

function def(name: EaseName, fn: (t: number) => number): EaseFn {
  const out = fn as EaseFn;
  out.easeId = name;
  return out;
}

function outBounce(t: number): number {
  const a = (121 * t * t) / 16;
  const b = (363 / 40 * t * t) - (99 / 10 * t) + 17 / 5;
  const c = (4356 / 361 * t * t) - (35442 / 1805 * t) + 16061 / 1805;
  const d = (54 / 5 * t * t) - (513 / 25 * t) + 268 / 25;
  return t < 4 / 11 ? a : t < 8 / 11 ? b : t < 9 / 10 ? c : d;
}

export const ease: Record<EaseName, EaseFn> = {
  linear: def("linear", (t) => t),
  in_quad: def("in_quad", (t) => t * t),
  out_quad: def("out_quad", (t) => -t * (t - 2)),
  in_out_quad: def("in_out_quad", (t) => t < 0.5 ? 2 * t * t : -0.5 * ((2 * t - 1) * (2 * t - 3) - 1)),
  in_cubic: def("in_cubic", (t) => t * t * t),
  out_cubic: def("out_cubic", (t) => (t - 1) ** 3 + 1),
  in_out_cubic: def("in_out_cubic", (t) => t * 2 < 1 ? 0.5 * (t * 2) ** 3 : 0.5 * ((t * 2 - 2) ** 3 + 2)),
  in_quart: def("in_quart", (t) => t ** 4),
  out_quart: def("out_quart", (t) => -((t - 1) ** 4 - 1)),
  in_out_quart: def("in_out_quart", (t) => t * 2 < 1 ? 0.5 * (t * 2) ** 4 : -0.5 * ((t * 2 - 2) ** 4 - 2)),
  in_quint: def("in_quint", (t) => t ** 5),
  out_quint: def("out_quint", (t) => (t - 1) ** 5 + 1),
  in_out_quint: def("in_out_quint", (t) => t * 2 < 1 ? 0.5 * (t * 2) ** 5 : 0.5 * ((t * 2 - 2) ** 5 + 2)),
  in_sine: def("in_sine", (t) => -Math.cos(t * Math.PI / 2) + 1),
  out_sine: def("out_sine", (t) => Math.sin(t * Math.PI / 2)),
  in_out_sine: def("in_out_sine", (t) => -0.5 * (Math.cos(Math.PI * t) - 1)),
  in_expo: def("in_expo", (t) => t === 0 ? 0 : 2 ** (10 * (t - 1))),
  out_expo: def("out_expo", (t) => t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  in_out_expo: def("in_out_expo", (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 0.5 * 2 ** (20 * t - 10) : 1 - 0.5 * 2 ** (-20 * t + 10)),
  in_circ: def("in_circ", (t) => -(Math.sqrt(1 - t * t) - 1)),
  out_circ: def("out_circ", (t) => Math.sqrt(Math.max(0, 1 - (t - 1) ** 2))),
  in_out_circ: def("in_out_circ", (t) => {
    const u = t * 2;
    return u < 1
      ? -0.5 * (Math.sqrt(Math.max(0, 1 - u * u)) - 1)
      : 0.5 * (Math.sqrt(Math.max(0, 1 - (u - 2) ** 2)) + 1);
  }),
  in_elastic: def("in_elastic", (t) => -(2 ** (10 * (t - 1)) * Math.sin((t - 1 - 0.5 / 4) * (2 * Math.PI) / 0.5))),
  out_elastic: def("out_elastic", (t) => 2 ** (-10 * t) * Math.sin((t - 0.5 / 4) * (2 * Math.PI / 0.5)) + 1),
  in_out_elastic: def("in_out_elastic", (t) => {
    const u = t * 2;
    const v = u - 1;
    const a = -0.5 * (2 ** (10 * v) * Math.sin((v - 0.5 / 4) * 2 * Math.PI / 0.5));
    const b = 2 ** (-10 * v) * Math.sin((v - 0.5 / 4) * 2 * Math.PI / 0.5) * 0.5 + 1;
    return u < 1 ? a : b;
  }),
  in_back: def("in_back", (t) => t * t * ((1.70158 + 1) * t - 1.70158)),
  out_back: def("out_back", (t) => (t - 1) ** 2 * ((1.70158 + 1) * (t - 1) + 1.70158) + 1),
  in_out_back: def("in_out_back", (t) => {
    const k = 1.70158 * 1.525;
    const u = t * 2;
    return u < 1 ? 0.5 * (u * u * ((k + 1) * u - k)) : 0.5 * ((u - 2) ** 2 * ((k + 1) * (u - 2) + k) + 2);
  }),
  in_bounce: def("in_bounce", (t) => 1 - outBounce(1 - t)),
  out_bounce: def("out_bounce", outBounce),
  in_out_bounce: def("in_out_bounce", (t) => t < 0.5 ? (1 - outBounce(1 - 2 * t)) * 0.5 : outBounce(2 * t - 1) * 0.5 + 0.5),
  in_square: def("in_square", (t) => t < 1 ? 0 : 1),
  out_square: def("out_square", (t) => t > 0 ? 1 : 0),
  in_out_square: def("in_out_square", (t) => t < 0.5 ? 0 : 1),
};

export function easeName(fn: EaseFn | EaseName | undefined): EaseName {
  if (!fn) return "linear";
  return typeof fn === "string" ? fn : fn.easeId;
}

export function easeValue(name: EaseName, t: number): number {
  return ease[name](t);
}
