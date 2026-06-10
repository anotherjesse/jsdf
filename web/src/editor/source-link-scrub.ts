import type { GraphSourceLink } from "./clean-source-patch";
import { scrubNumericParamValue, type ScrubModifiers } from "./scrub-values";

export function readSourceLinkNumber(source: string, link: GraphSourceLink): number | null {
  const value = Number(source.slice(link.start, link.end));
  return Number.isFinite(value) ? value : null;
}

export function scrubSourceLinkValue(
  link: GraphSourceLink,
  startValue: number,
  deltaPixels: number,
  modifiers: ScrubModifiers,
): number {
  return scrubNumericParamValue(link.label, startValue, deltaPixels, modifiers);
}
