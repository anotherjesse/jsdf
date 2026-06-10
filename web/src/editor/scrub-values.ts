export interface ScrubModifiers {
  altKey: boolean;
  shiftKey: boolean;
}

export function scrubNumericParamValue(
  label: string,
  startValue: number,
  deltaPixels: number,
  modifiers: ScrubModifiers,
): number {
  const step = scrubStepFor(label, startValue, modifiers);
  return normalizeScrubbedValue(label, startValue + deltaPixels * step);
}

function scrubStepFor(label: string, startValue: number, modifiers: ScrubModifiers): number {
  if (isCountParamLabel(label)) {
    return modifiers.altKey ? 0.05 : modifiers.shiftKey ? 0.2 : 1;
  }

  const size = Math.abs(startValue);
  const base = size >= 10 ? 0.1 : size >= 1 ? 0.025 : 0.005;
  if (modifiers.altKey) return base * 0.1;
  if (modifiers.shiftKey) return base * 0.25;
  return base;
}

function normalizeScrubbedValue(label: string, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (isCountParamLabel(label)) return Math.max(1, Math.round(value));
  if (isNonNegativeParamLabel(label)) return Math.max(0, value);
  return value;
}

export function isCountParamLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return lower === "count" || lower.endsWith(".count") || lower.startsWith("count[");
}

export function isNonNegativeParamLabel(label: string): boolean {
  const lower = label.toLowerCase();
  if (lower.startsWith("entries[") && lower.endsWith(".k")) return true;
  return /(^|\.)(radius|r|r0|r1|thickness|h|padding|scaledistance)$/.test(lower)
    || lower.startsWith("size")
    || lower.startsWith("factor")
    || lower.startsWith("spacing");
}
