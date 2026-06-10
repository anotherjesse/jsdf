export interface SourceDiagnostic {
  message: string;
  lineNumber: number;
  column: number;
  endLineNumber: number;
  endColumn: number;
}

const GENERATED_FUNCTION_LINE_OFFSET = 3;

export function sourceDiagnosticFromError(error: unknown, source: string): SourceDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? "" : "";
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
  const match = stack.match(/(?:sdf-editor-source\.js|<anonymous>):(\d+):(\d+)/);
  if (!match) return null;
  const generatedLine = Number(match[1]);
  const column = Number(match[2]);
  if (!Number.isFinite(generatedLine) || !Number.isFinite(column)) return null;
  const lineNumber = generatedLine - GENERATED_FUNCTION_LINE_OFFSET;
  if (lineNumber < 1 || lineNumber > sourceLineCount(source)) return null;
  return wordRangeAt(sourceLine(source, lineNumber), lineNumber, column);
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
