export function prettifySource(source: string): string {
  const normalized = source.replace(/\r\n?/g, "\n");
  const output: string[] = [];
  let pendingBlank = false;

  for (const rawLine of normalized.split("\n")) {
    const line = normalizeLine(rawLine);
    if (!line) {
      pendingBlank = output.length > 0;
      continue;
    }
    if (pendingBlank) output.push("");
    pendingBlank = false;
    output.push(...formatChainLine(line));
  }

  return output.join("\n").trim();
}

function normalizeLine(line: string): string {
  return normalizeCommaSpacing(line.trim())
    .replace(/^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)\s*/, "$1 $2 = ")
    .replace(/^([A-Za-z_$][\w$]*)\s*=(?!=)\s*/, "$1 = ")
    .replace(/^return\s+/, "return ");
}

function normalizeCommaSpacing(line: string): string {
  let next = "";
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      next += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      next += char;
      continue;
    }
    if (char === ",") {
      next = next.replace(/\s+$/, "");
      next += ", ";
      while (line[index + 1] === " ") index += 1;
      continue;
    }
    next += char;
  }

  return next;
}

function formatChainLine(line: string): string[] {
  const assignment = line.match(/^((?:(?:const|let|var)\s+)?[A-Za-z_$][\w$]*\s*=\s*)(.+)$/);
  const returnStatement = line.match(/^(return\s+)(.+)$/);
  const prefix = assignment?.[1] ?? returnStatement?.[1] ?? "";
  const expression = assignment?.[2] ?? returnStatement?.[2] ?? line;
  if (!expression) return [line];
  const parts = splitTopLevelChain(expression);
  if (parts.length < 2) return [line];
  return [`${prefix}${parts[0]}`, ...parts.slice(1).map((part) => `  .${part}`)];
}

function splitTopLevelChain(expression: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;
    if (char !== "." || parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) continue;
    if (!isChainDot(expression, index)) continue;
    parts.push(expression.slice(start, index).trim());
    start = index + 1;
  }

  if (parts.length === 0) return [expression];
  parts.push(expression.slice(start).trim());
  return parts.filter(Boolean);
}

function isChainDot(expression: string, index: number): boolean {
  const before = expression[index - 1] ?? "";
  const after = expression[index + 1] ?? "";
  if (!/[A-Za-z_$]/.test(after)) return false;
  if (/[)\]]/.test(before)) return true;
  if (!/[$\w]/.test(before)) return false;

  const receiver = identifierBefore(expression, index);
  if (!receiver || receiver === "ease" || receiver === "Math") return false;

  let cursor = index + 1;
  while (/[$\w]/.test(expression[cursor] ?? "")) cursor += 1;
  while (/\s/.test(expression[cursor] ?? "")) cursor += 1;
  return expression[cursor] === "(";
}

function identifierBefore(expression: string, index: number): string {
  let start = index;
  while (start > 0 && /[$\w]/.test(expression[start - 1])) start -= 1;
  return expression.slice(start, index);
}
