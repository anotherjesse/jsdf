import { apiCompletionEntriesForScope, type ApiReferenceEntry } from "./api-reference";
import type { ApiCompletionScope } from "./api-reference-data";

export interface SourceCompletionContext {
  scope: ApiCompletionScope;
  token: string;
}

export interface SourceCompletionEntry {
  entry: ApiReferenceEntry;
  filterText: string;
  insertAsSnippet: boolean;
  insertText: string;
  matchRank: number;
  sortText: string;
}

interface CompletionParam {
  label: string;
  optional: boolean;
  optionsObject: boolean;
}

const IDENTIFIER_TRIGGER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$0123456789".split("");

export const SOURCE_COMPLETION_TRIGGER_CHARACTERS = [".", ...IDENTIFIER_TRIGGER_CHARS] as const;

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
    matchRank: completionMatchRank(entry.name.toLowerCase(), token),
    ...sourceCompletionInsert(entry, context),
    sortText: sourceCompletionSortText(entry, token),
  }));
}

export function sourceCompletionMatchesToken(entry: SourceCompletionEntry, token: string): boolean {
  return completionMatchRank(entry.entry.name.toLowerCase(), token.toLowerCase()) < 4;
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

function sourceCompletionInsert(
  entry: ApiReferenceEntry,
  context: SourceCompletionContext,
): Pick<SourceCompletionEntry, "insertAsSnippet" | "insertText"> {
  if (entry.kind !== "function" && entry.kind !== "method") {
    return {
      insertAsSnippet: false,
      insertText: entry.name,
    };
  }

  const params = callableParamsForEntry(entry, context);
  if (!params) {
    return {
      insertAsSnippet: false,
      insertText: entry.name,
    };
  }

  if (params.length === 0) {
    return {
      insertAsSnippet: false,
      insertText: `${entry.name}()`,
    };
  }

  const placeholders = params.map((param, index) => `\${${index + 1}:${escapeSnippetPlaceholder(param)}}`);
  return {
    insertAsSnippet: true,
    insertText: `${entry.name}(${placeholders.join(", ")})$0`,
  };
}

function callableParamsForEntry(entry: ApiReferenceEntry, context: SourceCompletionContext): string[] | null {
  const signatureParams = paramsFromSignature(entry.signature, entry.name);
  if (!signatureParams) return null;
  let params = signatureParams.map(parseCompletionParam).filter((param): param is CompletionParam => param != null);
  if (context.scope === "method" && !entry.signature.includes(`.${entry.name}(`) && entry.completionScopes.includes("global")) {
    params = params.slice(1);
  }
  return snippetParams(params);
}

function paramsFromSignature(signature: string, name: string): string[] | null {
  const callIndex = signature.indexOf(`${name}(`);
  if (callIndex < 0) return null;
  const open = signature.indexOf("(", callIndex + name.length);
  if (open < 0) return null;
  const close = matchingCloseParen(signature, open);
  if (close < 0) return null;
  return splitParams(signature.slice(open + 1, close));
}

function matchingCloseParen(value: string, open: number): number {
  let depth = 0;
  for (let index = open; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitParams(value: string): string[] {
  const params: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      params.push(value.slice(start, index));
      start = index + 1;
    }
  }
  const tail = value.slice(start);
  if (tail.trim()) params.push(tail);
  return params;
}

function parseCompletionParam(param: string): CompletionParam | null {
  const raw = param.trim();
  const label = cleanParamLabel(raw);
  if (!label) return null;
  const optionsObject = raw.startsWith("{") && raw.endsWith("}");
  return {
    label,
    optional: isOptionalSnippetParam(raw),
    optionsObject,
  };
}

function snippetParams(params: readonly CompletionParam[]): string[] {
  const required = params.filter((param) => !param.optional);
  if (required.length > 0) return required.map((param) => snippetPlaceholderLabel(param.label));

  const primaryOptional = params.find((param) => !param.optionsObject);
  return primaryOptional ? [snippetPlaceholderLabel(primaryOptional.label)] : [];
}

function isOptionalSnippetParam(param: string): boolean {
  if (param.startsWith("...")) return false;
  return param.includes("=")
    || /^[$A-Z_a-z][$\w]*\?$/.test(param)
    || /^\{\s*[$A-Z_a-z][$\w]*\?\s*\}$/.test(param);
}

function cleanParamLabel(param: string): string {
  return param
    .trim()
    .replace(/^\.\.\./, "")
    .replace(/\s*=\s*.+$/, "")
    .replace(/\?$/, "")
    .trim();
}

function snippetPlaceholderLabel(label: string): string {
  if (label === "rest" || label === "others") return "other";
  return label;
}

function escapeSnippetPlaceholder(value: string): string {
  return value.replace(/[\\$}]/g, "\\$&");
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
