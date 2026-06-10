import type { GraphSourceLink } from "./clean-source-patch";

export function readSourceLinkNumber(source: string, link: GraphSourceLink): number | null {
  const value = Number(source.slice(link.start, link.end));
  return Number.isFinite(value) ? value : null;
}

export function scrubSourceLinkValue(
  link: GraphSourceLink,
  startValue: number,
  deltaPixels: number,
  modifiers: { altKey: boolean; shiftKey: boolean },
): number {
  const step = scrubStepFor(link, startValue, modifiers);
  return normalizeScrubbedValue(link, startValue + deltaPixels * step);
}

function scrubStepFor(
  link: GraphSourceLink,
  startValue: number,
  modifiers: { altKey: boolean; shiftKey: boolean },
): number {
  if (isCountParam(link.label)) {
    return modifiers.altKey ? 0.05 : modifiers.shiftKey ? 0.2 : 1;
  }

  const size = Math.abs(startValue);
  const base = size >= 10 ? 0.1 : size >= 1 ? 0.025 : 0.005;
  if (modifiers.altKey) return base * 0.1;
  if (modifiers.shiftKey) return base * 0.25;
  return base;
}

function normalizeScrubbedValue(link: GraphSourceLink, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (isCountParam(link.label)) return Math.max(1, Math.round(value));
  if (isNonNegativeParam(link.label)) return Math.max(0, value);
  return value;
}

function isCountParam(label: string): boolean {
  const lower = label.toLowerCase();
  return lower === "count" || lower.endsWith(".count") || lower.startsWith("count[");
}

function isNonNegativeParam(label: string): boolean {
  const lower = label.toLowerCase();
  return /(^|\.)(radius|r|r0|r1|thickness|h|padding|scaledistance)$/.test(lower)
    || lower.startsWith("size")
    || lower.startsWith("factor")
    || lower.startsWith("spacing");
}
