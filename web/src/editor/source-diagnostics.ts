import type { ApiCompletionScope } from "./api-reference-data";
import { apiSuggestionForTypo } from "./source-diagnostic-suggestions";

export interface SourceDiagnostic {
  message: string;
  lineNumber: number;
  column: number;
  endLineNumber: number;
  endColumn: number;
}

const GENERATED_FUNCTION_LINE_OFFSETS = [3, 2, 1, 0] as const;
const IDENTIFIER_RE = /^[$A-Z_a-z][$\w]*$/;

export function sourceDiagnosticFromError(error: unknown, source: string): SourceDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? "" : "";
  const stackPosition = positionFromStack(stack, source);
  const runtimeRange = rangeFromRuntimeMessage(message, source, stackPosition);
  if (runtimeRange) {
    return {
      message: messageWithApiSuggestion(message, source, runtimeRange),
      ...runtimeRange.range,
    };
  }
  const stackRange = rangeFromStack(stack, source);
  if (stackRange) return { message, ...stackRange };
  const syntaxRange = rangeFromSyntaxMessage(message, source);
  if (syntaxRange) return { message, ...syntaxRange };
  return {
    message,
    lineNumber: 1,
    column: 1,
    endLineNumber: 1,
    endColumn: Math.max(2, sourceLine(source, 1).length + 1),
  };
}

function rangeFromStack(stack: string, source: string): Omit<SourceDiagnostic, "message"> | null {
  const position = positionFromStack(stack, source);
  if (!position) return null;
  return wordRangeAt(sourceLine(source, position.lineNumber), position.lineNumber, position.column);
}

function positionFromStack(stack: string, source: string): SourcePosition | null {
  const match = stack.match(/(?:sdf-editor-source\.js|<anonymous>):(\d+):(\d+)/);
  if (!match) return null;
  const generatedLine = Number(match[1]);
  const column = Number(match[2]);
  if (!Number.isFinite(generatedLine) || !Number.isFinite(column)) return null;
  for (const offset of GENERATED_FUNCTION_LINE_OFFSETS) {
    const lineNumber = generatedLine - offset;
    if (lineNumber >= 1 && lineNumber <= sourceLineCount(source)) {
      return { lineNumber, column };
    }
  }
  return null;
}

function rangeFromRuntimeMessage(
  message: string,
  source: string,
  position: SourcePosition | null,
): RuntimeTokenRange | null {
  const token = runtimeTokenFromMessage(message);
  if (!token) return null;
  const range = rangeForToken(source, token, position);
  return range ? { token, range } : null;
}

function runtimeTokenFromMessage(message: string): string | null {
  const token = [
    message.match(/^([$A-Z_a-z][$\w]*) is not defined$/)?.[1],
    message.match(/(?:^|\.)([$A-Z_a-z][$\w]*) is not a function$/)?.[1],
    message.match(/(?:^|\.)([$A-Z_a-z][$\w]*) is not a constructor$/)?.[1],
    message.match(/\(reading ['"]([$A-Z_a-z][$\w]*)['"]\)/)?.[1],
  ].find(Boolean);
  return token && IDENTIFIER_RE.test(token) ? token : null;
}

function rangeForToken(
  source: string,
  token: string,
  position: SourcePosition | null,
): Omit<SourceDiagnostic, "message"> | null {
  if (position) {
    const lineRange = tokenRangeOnLine(sourceLine(source, position.lineNumber), position.lineNumber, token, position.column);
    if (lineRange) return lineRange;
  }

  const lines = sourceLines(source);
  let best: TokenCandidate | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    for (const candidate of tokenRangesOnLine(lines[index], index + 1, token)) {
      if (!position) return candidate.range;
      const distance = Math.abs(candidate.lineNumber - position.lineNumber) * 1000
        + Math.abs(candidate.column - position.column);
      if (!best || distance < best.distance) best = { ...candidate, distance };
    }
  }
  return best?.range ?? null;
}

function rangeFromSyntaxMessage(message: string, source: string): Omit<SourceDiagnostic, "message"> | null {
  const token = message.match(/Unexpected (?:token|identifier) ['"]?([^'"]+)['"]?/i)?.[1];
  if (!token || token === "}") return endOfSourceRange(source);
  const lines = sourceLines(source);
  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(token) + 1;
    if (column > 0) {
      return {
        lineNumber: index + 1,
        column,
        endLineNumber: index + 1,
        endColumn: column + token.length,
      };
    }
  }
  return endOfSourceRange(source);
}

function messageWithApiSuggestion(message: string, source: string, tokenRange: RuntimeTokenRange): string {
  const scope = completionScopeForRange(source, tokenRange.range);
  const suggestion = apiSuggestionForTypo(tokenRange.token, scope);
  if (!suggestion || suggestion === tokenRange.token) return message;
  const target = scope === "method" ? `.${suggestion}` : scope === "ease" ? `ease.${suggestion}` : suggestion;
  return `${message} Did you mean ${target}?`;
}

function completionScopeForRange(source: string, range: Omit<SourceDiagnostic, "message">): ApiCompletionScope {
  const before = sourceLine(source, range.lineNumber).slice(0, Math.max(0, range.column - 1)).trimEnd();
  if (!before.endsWith(".")) return "global";
  const qualifier = before.slice(0, -1).trimEnd().match(/[$A-Z_a-z][$\w]*$/)?.[0];
  return qualifier === "ease" ? "ease" : "method";
}

function tokenRangeOnLine(
  line: string,
  lineNumber: number,
  token: string,
  preferredColumn: number,
): Omit<SourceDiagnostic, "message"> | null {
  const candidates = tokenRangesOnLine(line, lineNumber, token);
  let best: TokenRangeOnLine | null = null;
  for (const candidate of candidates) {
    const distance = Math.min(
      Math.abs(candidate.column - preferredColumn),
      Math.abs(candidate.endColumn - preferredColumn),
    );
    if (!best || distance < best.distance) best = { ...candidate, distance };
  }
  return best?.range ?? null;
}

function tokenRangesOnLine(line: string, lineNumber: number, token: string): TokenRangeOnLine[] {
  const ranges: TokenRangeOnLine[] = [];
  let start = line.indexOf(token);
  while (start >= 0) {
    const end = start + token.length;
    if (isIdentifierBoundary(line[start - 1]) && isIdentifierBoundary(line[end])) {
      ranges.push({
        lineNumber,
        column: start + 1,
        endColumn: end + 1,
        distance: 0,
        range: {
          lineNumber,
          column: start + 1,
          endLineNumber: lineNumber,
          endColumn: end + 1,
        },
      });
    }
    start = line.indexOf(token, start + token.length);
  }
  return ranges;
}

function isIdentifierBoundary(char: string | undefined): boolean {
  return !char || !/[$\w]/.test(char);
}

function wordRangeAt(line: string, lineNumber: number, column: number): Omit<SourceDiagnostic, "message"> {
  const cursor = clamp(column - 1, 0, Math.max(0, line.length - 1));
  if (!/[$\w]/.test(line[cursor] ?? "")) {
    return {
      lineNumber,
      column: Math.max(1, column),
      endLineNumber: lineNumber,
      endColumn: Math.max(2, column + 1),
    };
  }
  let start = cursor;
  let end = cursor + 1;
  while (start > 0 && /[$\w]/.test(line[start - 1])) start -= 1;
  while (end < line.length && /[$\w]/.test(line[end])) end += 1;
  return {
    lineNumber,
    column: start + 1,
    endLineNumber: lineNumber,
    endColumn: end + 1,
  };
}

function endOfSourceRange(source: string): Omit<SourceDiagnostic, "message"> {
  const lines = sourceLines(source);
  const lineNumber = Math.max(1, lines.length);
  const line = lines[lineNumber - 1] ?? "";
  const column = Math.max(1, line.length);
  return {
    lineNumber,
    column,
    endLineNumber: lineNumber,
    endColumn: column + 1,
  };
}

function sourceLine(source: string, lineNumber: number): string {
  return sourceLines(source)[lineNumber - 1] ?? "";
}

function sourceLineCount(source: string): number {
  return sourceLines(source).length;
}

function sourceLines(source: string): string[] {
  return source.replace(/\r\n?/g, "\n").split("\n");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface SourcePosition {
  lineNumber: number;
  column: number;
}

interface RuntimeTokenRange {
  token: string;
  range: Omit<SourceDiagnostic, "message">;
}

interface TokenRangeOnLine {
  lineNumber: number;
  column: number;
  endColumn: number;
  distance: number;
  range: Omit<SourceDiagnostic, "message">;
}

interface TokenCandidate extends TokenRangeOnLine {}
