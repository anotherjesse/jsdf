import { apiCompletionEntriesForScope, type ApiReferenceEntry } from "./api-reference";
import type { ApiCompletionScope } from "./api-reference-data";

export interface SourceCompletionContext {
  scope: ApiCompletionScope;
  token: string;
}

export interface SourceCompletionEntry {
  entry: ApiReferenceEntry;
  filterText: string;
  sortText: string;
}

export function sourceCompletionContextAt(source: string, lineNumber: number, column: number): SourceCompletionContext {
  const line = sourceLine(source, lineNumber);
  const beforeCursor = line.slice(0, Math.max(0, column - 1));
  const token = beforeCursor.match(/[$A-Z_a-z][$\w]*$/)?.[0] ?? "";
  const beforeToken = beforeCursor.slice(0, beforeCursor.length - token.length).trimEnd();
  if (!beforeToken.endsWith(".")) return { scope: "global", token };
  const qualifier = beforeToken.slice(0, -1).trimEnd().match(/[$A-Z_a-z][$\w]*$/)?.[0] ?? "";
  return {
    scope: qualifier === "ease" ? "ease" : "method",
    token,
  };
}

export function sourceCompletionEntries(context: SourceCompletionContext): SourceCompletionEntry[] {
  const token = context.token.toLowerCase();
  return apiCompletionEntriesForScope(context.scope).map((entry) => ({
    entry,
    filterText: entry.name,
    sortText: sourceCompletionSortText(entry, token),
  }));
}

export function sourceCompletionSortText(entry: ApiReferenceEntry, lowerToken: string): string {
  const name = entry.name.toLowerCase();
  const matchRank = completionMatchRank(name, lowerToken);
  return [
    String(matchRank).padStart(2, "0"),
    completionGroupRank(entry.group).toString().padStart(2, "0"),
    entry.name,
  ].join(":");
}

function completionMatchRank(name: string, lowerToken: string): number {
  if (!lowerToken) return 2;
  if (name === lowerToken) return 0;
  if (name.startsWith(lowerToken)) return 1;
  if (isSubsequence(lowerToken, name)) return 3;
  return 4;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

function completionGroupRank(group: string): number {
  const order = [
    "3D Primitives",
    "2D Primitives",
    "CSG",
    "Transforms",
    "2D/3D",
    "Workflow",
    "Math",
    "Easing",
    "Classes",
    "Namespaces",
    "Helpers",
  ];
  const index = order.indexOf(group);
  return index === -1 ? order.length : index;
}

function sourceLine(source: string, lineNumber: number): string {
  return source.split(/\r?\n/)[lineNumber - 1] ?? "";
}
