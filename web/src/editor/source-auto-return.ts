export interface AutoReturnResult {
  source: string;
  expression: string;
}

const STATEMENT_START_RE = /^(?:const|let|var|import|export|function|class|if|for|while|switch|try|catch|finally|else|do|return|throw|break|continue)\b/;
const OPERATOR_END_RE = /(?:[+\-*/%&|?:,.=<>!]|\b(?:in|instanceof))$/;

export function sourceWithAutoReturnExpression(source: string): AutoReturnResult | null {
  const normalized = source.replace(/\r\n?/g, "\n");
  if (hasTopLevelReturn(normalized)) return null;

  const line = finalCodeLine(normalized);
  if (!line) return null;
  const fragment = finalStatementFragment(line.text);
  if (!fragment) return null;

  const expressionStart = line.start + fragment.start;
  const expressionEnd = line.start + fragment.end;
  const expression = normalized.slice(expressionStart, expressionEnd).trim().replace(/;+\s*$/, "").trim();
  if (!isAutoReturnExpression(expression)) return null;

  return {
    source: `${normalized.slice(0, expressionStart)}return ${expression};${normalized.slice(expressionEnd)}`,
    expression,
  };
}

export function hasTopLevelReturn(source: string): boolean {
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const next = skipNonCode(source, index);
    if (next !== index) {
      index = next - 1;
      continue;
    }

    const char = source[index];
    if (char === "{" || char === "(" || char === "[") depth += 1;
    if (char === "}" || char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && isWordAt(source, index, "return")) return true;
  }
  return false;
}

function finalCodeLine(source: string): { start: number; text: string } | null {
  let end = source.length;
  while (end > 0) {
    const start = source.lastIndexOf("\n", end - 1) + 1;
    const text = source.slice(start, end);
    if (lineCodeEnd(text) > firstNonWhitespace(text)) {
      return { start, text };
    }
    end = Math.max(0, start - 1);
  }
  return null;
}

function finalStatementFragment(line: string): { start: number; end: number } | null {
  const codeEnd = lineCodeEnd(line);
  let start = lastTopLevelSemicolon(line, codeEnd) + 1;
  while (start < codeEnd && /\s/.test(line[start])) start += 1;
  let end = codeEnd;
  while (end > start && /\s/.test(line[end - 1])) end -= 1;
  return end > start ? { start, end } : null;
}

function isAutoReturnExpression(expression: string): boolean {
  return expression !== ""
    && !STATEMENT_START_RE.test(expression)
    && !expression.startsWith(".")
    && !OPERATOR_END_RE.test(expression)
    && delimitersCanBalance(expression);
}

function lastTopLevelSemicolon(line: string, end: number): number {
  let last = -1;
  let depth = 0;
  for (let index = 0; index < end; index += 1) {
    const next = skipNonCode(line, index);
    if (next !== index) {
      index = next - 1;
      continue;
    }
    const char = line[index];
    if (char === "{" || char === "(" || char === "[") depth += 1;
    if (char === "}" || char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (char === ";" && depth === 0) last = index;
  }
  return last;
}

function delimitersCanBalance(source: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (let index = 0; index < source.length; index += 1) {
    const next = skipNonCode(source, index);
    if (next !== index) {
      index = next - 1;
      continue;
    }
    const char = source[index];
    if (char === "(" || char === "[" || char === "{") stack.push(char);
    if (char === ")" || char === "]" || char === "}") {
      if (stack.pop() !== pairs[char]) return false;
    }
  }
  return stack.length === 0;
}

function lineCodeEnd(line: string): number {
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" || char === "'" || char === "`" || char === "/") {
      const next = skipNonCode(line, index);
      if (next === line.length && line[index] === "/" && line[index + 1] === "/") return index;
      if (next !== index) {
        index = next - 1;
      }
    }
  }
  return line.length;
}

function skipNonCode(source: string, index: number): number {
  const char = source[index];
  const next = source[index + 1];
  if (char === "/" && next === "/") {
    const newline = source.indexOf("\n", index + 2);
    return newline < 0 ? source.length : newline;
  }
  if (char === "/" && next === "*") {
    const close = source.indexOf("*/", index + 2);
    return close < 0 ? source.length : close + 2;
  }
  if (char === "\"" || char === "'" || char === "`") {
    return skipString(source, index, char);
  }
  return index;
}

function skipString(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === quote) return index + 1;
  }
  return source.length;
}

function isWordAt(source: string, index: number, word: string): boolean {
  return source.slice(index, index + word.length) === word
    && isWordBoundary(source[index - 1])
    && isWordBoundary(source[index + word.length]);
}

function isWordBoundary(char: string | undefined): boolean {
  return !char || !/[$\w]/.test(char);
}

function firstNonWhitespace(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (!/\s/.test(value[index])) return index;
  }
  return value.length;
}
