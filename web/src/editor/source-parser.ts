export interface SourceRange {
  start: number;
  end: number;
  scalarVector?: boolean;
}

export interface CallArg {
  start: number;
  end: number;
  text: string;
}

export interface CallMatch {
  start: number;
  nameStart: number;
  nameEnd: number;
  args: CallArg[];
}

export function findCalls(source: string, fns: string | string[]): CallMatch[] {
  const calls: CallMatch[] = [];
  for (const fn of Array.isArray(fns) ? fns : [fns]) {
    const pattern = new RegExp(`\\b${escapeRegExp(fn)}\\s*\\(`, "g");
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
      const open = source.indexOf("(", match.index);
      const close = findMatchingParen(source, open);
      if (close < 0) continue;
      calls.push({
        start: match.index,
        nameStart: match.index,
        nameEnd: match.index + fn.length,
        args: splitArgs(source, open + 1, close),
      });
      pattern.lastIndex = close + 1;
    }
  }
  return calls.sort((a, b) => a.start - b.start);
}

export function numericArgRange(source: string, call: CallMatch, index: number): SourceRange | null {
  const arg = call.args[index];
  if (!arg || !isNumericLiteral(arg.text)) return null;
  return trimRange(source, arg.start, arg.end);
}

export function findMatchingParen(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\" && i + 1 < source.length) {
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (depth === 0) return i;
  }
  return -1;
}

export function splitArgs(source: string, start: number, end: number): CallArg[] {
  const args: CallArg[] = [];
  let depth = 0;
  let quote: string | null = null;
  let argStart = start;
  for (let i = start; i <= end; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\" && i + 1 < source.length) {
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if ((char === "," && depth === 0) || i === end) {
      const argEnd = i === end ? end : i;
      args.push({ start: argStart, end: argEnd, text: source.slice(argStart, argEnd) });
      argStart = i + 1;
    }
  }
  return args;
}

export function firstNonWhitespace(source: string, start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (!/\s/.test(source[index])) return index;
  }
  return -1;
}

export function isNumericLiteral(value: string): boolean {
  return /^\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value);
}

export function trimRange(source: string, start: number, end: number): SourceRange {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/.test(source[trimmedStart])) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/.test(source[trimmedEnd - 1])) trimmedEnd -= 1;
  return { start: trimmedStart, end: trimmedEnd };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
