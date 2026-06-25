export type ColorInput = string | ArrayLike<number>;

export function asColor(value: ColorInput): [number, number, number] {
  if (typeof value === "string") return hexColor(value);
  const color: [number, number, number] = [Number(value[0]), Number(value[1]), Number(value[2])];
  if (!color.every(Number.isFinite)) throw new Error(`invalid color: ${String(value)}`);
  const scale = color.some((channel) => Math.abs(channel) > 1) ? 255 : 1;
  return color.map((channel) => clamp01(channel / scale)) as [number, number, number];
}

export function colorToHex(color: readonly number[]): string {
  const [r, g, b] = asColor(color);
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

function hexColor(value: string): [number, number, number] {
  const trimmed = value.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (short) {
    return short[1].split("").map((channel) => parseInt(channel + channel, 16) / 255) as [number, number, number];
  }
  const long = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (long) {
    return [
      parseInt(long[1].slice(0, 2), 16) / 255,
      parseInt(long[1].slice(2, 4), 16) / 255,
      parseInt(long[1].slice(4, 6), 16) / 255,
    ];
  }
  throw new Error(`invalid color: ${value}`);
}

function hexByte(value: number): string {
  return Math.round(clamp01(value) * 255).toString(16).padStart(2, "0");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
