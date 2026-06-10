import { apiReferenceForWord, apiReferenceSignatureForScope, type ApiReferenceEntry } from "./api-reference";
import type { ApiCompletionScope } from "./api-reference-data";

export interface ApiSignatureHelp {
  entry: ApiReferenceEntry;
  signature: string;
  parameters: string[];
  activeParameter: number;
}

export function apiSignatureHelpAt(line: string, column: number): ApiSignatureHelp | null {
  const beforeCursor = line.slice(0, Math.max(0, column - 1));
  const openIndex = currentCallOpenIndex(beforeCursor);
  if (openIndex == null) return null;

  const target = callTargetBeforeOpen(beforeCursor, openIndex);
  if (!target) return null;

  const entry = apiReferenceForWord(target.name);
  if (!entry) return null;
  const scope = signatureScopeForTarget(target);
  if (!entry.completionScopes.includes(scope)) return null;
  const signature = apiReferenceSignatureForScope(entry, scope);
  if (!signature.includes("(")) return null;

  const parameters = signatureParameterLabels(signature);
  const activeParameter = activeParameterIndex(beforeCursor.slice(openIndex + 1), parameters.length);
  return { entry, signature, parameters, activeParameter };
}

export function signatureParameterLabels(signature: string): string[] {
  const openIndex = signature.indexOf("(");
  if (openIndex < 0) return [];
  const closeIndex = matchingCloseParen(signature, openIndex);
  if (closeIndex == null) return [];
  return splitTopLevel(signature.slice(openIndex + 1, closeIndex))
    .map((part) => part.trim())
    .filter(Boolean);
}

function currentCallOpenIndex(source: string): number | null {
  const stack: number[] = [];
  let stringQuote: string | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (stringQuote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        stringQuote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      stringQuote = char;
      continue;
    }
    if (char === "(") stack.push(index);
    if (char === ")") stack.pop();
  }

  return stack.at(-1) ?? null;
}

interface CallTarget {
  name: string;
  qualifier: string | null;
  memberAccess: boolean;
}

function callTargetBeforeOpen(source: string, openIndex: number): CallTarget | null {
  let end = openIndex;
  while (end > 0 && /\s/.test(source[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[$\w]/.test(source[start - 1])) start -= 1;
  if (start >= end) return null;
  const memberAccess = memberAccessBefore(source, start);
  return {
    name: source.slice(start, end),
    qualifier: memberAccess.qualifier,
    memberAccess: memberAccess.hasDot,
  };
}

function memberAccessBefore(source: string, targetStart: number): { hasDot: boolean; qualifier: string | null } {
  let dotIndex = targetStart;
  while (dotIndex > 0 && /\s/.test(source[dotIndex - 1])) dotIndex -= 1;
  if (source[dotIndex - 1] !== ".") return { hasDot: false, qualifier: null };
  let end = dotIndex - 1;
  while (end > 0 && /\s/.test(source[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[$\w]/.test(source[start - 1])) start -= 1;
  return { hasDot: true, qualifier: start < end ? source.slice(start, end) : null };
}

function signatureScopeForTarget(target: CallTarget): ApiCompletionScope {
  if (target.qualifier === "ease") return "ease";
  return target.memberAccess ? "method" : "global";
}

function activeParameterIndex(argumentSource: string, parameterCount: number): number {
  if (parameterCount <= 0) return 0;
  let active = 0;
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let stringQuote: string | null = null;
  let escaped = false;

  for (const char of argumentSource) {
    if (stringQuote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        stringQuote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      stringQuote = char;
      continue;
    }
    if (char === "(") parens += 1;
    else if (char === ")") parens = Math.max(0, parens - 1);
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets = Math.max(0, brackets - 1);
    else if (char === "{") braces += 1;
    else if (char === "}") braces = Math.max(0, braces - 1);
    else if (char === "," && parens === 0 && brackets === 0 && braces === 0) active += 1;
  }

  return Math.min(active, parameterCount - 1);
}

function matchingCloseParen(source: string, openIndex: number): number | null {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parens = 0;
  let brackets = 0;
  let braces = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parens += 1;
    else if (char === ")") parens = Math.max(0, parens - 1);
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets = Math.max(0, brackets - 1);
    else if (char === "{") braces += 1;
    else if (char === "}") braces = Math.max(0, braces - 1);
    else if (char === "," && parens === 0 && brackets === 0 && braces === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}
