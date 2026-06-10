import { apiCompletionEntriesForScope, type ApiReferenceEntry } from "./api-reference";
import type { ApiCompletionScope } from "./api-reference-data";

export function apiSuggestionForTypo(token: string, scope: ApiCompletionScope): string | null {
  const entries = apiCompletionEntriesForScope(scope);
  const lowerToken = token.toLowerCase();
  const prefixMatch = lowerToken.length >= 3
    ? entries
      .filter((entry) => entry.name.toLowerCase().startsWith(lowerToken))
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))[0]
    : null;
  if (prefixMatch) return prefixMatch.name;

  let best: { entry: ApiReferenceEntry; distance: number } | null = null;
  for (const entry of entries) {
    const distance = levenshtein(lowerToken, entry.name.toLowerCase());
    if (distance > suggestionDistanceLimit(token, entry.name)) continue;
    if (!best || distance < best.distance || (distance === best.distance && entry.name.length < best.entry.name.length)) {
      best = { entry, distance };
    }
  }
  return best?.entry.name ?? null;
}

function suggestionDistanceLimit(token: string, candidate: string): number {
  const maxLength = Math.max(token.length, candidate.length);
  if (maxLength <= 4) return 1;
  if (maxLength <= 8) return 2;
  return 3;
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}
