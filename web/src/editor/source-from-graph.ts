import type { Node, SDF3 } from "../core/nodes";

interface SourceContext {
  constants: string[];
  nodeLines: string[];
  emittedNodes: Map<number, string>;
  emittedParams: Set<string>;
}

export function sourceFromSdf(sdf: SDF3): string {
  const context: SourceContext = {
    constants: [],
    nodeLines: [],
    emittedNodes: new Map<number, string>(),
    emittedParams: new Set<string>(),
  };
  const root = emitNode(sdf.node, context);
  return [
    "// Generated from graph edits.",
    "// Tweak constants here or keep editing in the graph inspector.",
    ...context.constants,
    "",
    ...context.nodeLines,
    `return ${root};`,
  ].join("\n");
}

function emitNode(node: Node, context: SourceContext): string {
  const existing = context.emittedNodes.get(node.id);
  if (existing) return existing;

  const children = node.children.map((child) => emitNode(child.node, context));
  const variable = `n${node.id}`;
  const op = node.dim === 2 ? "op2" : "op3";
  const params = emitParamValue(node.params, context, `p${node.id}`, []);
  const childArg = children.length > 0 ? `, [${children.join(", ")}]` : "";
  context.nodeLines.push(`const ${variable} = ${op}(${JSON.stringify(node.kind)}, ${params}${childArg});`);
  context.emittedNodes.set(node.id, variable);
  return variable;
}

function emitParamValue(value: unknown, context: SourceContext, prefix: string, path: Array<string | number>): string {
  if (typeof value === "number") return emitNumber(value, context, prefix, path);
  if (value == null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => emitParamValue(item, context, prefix, [...path, index])).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const fields = entries.map(([key, item]) => {
      return `${formatObjectKey(key)}: ${emitParamValue(item, context, prefix, [...path, key])}`;
    });
    return `{ ${fields.join(", ")} }`;
  }
  return "null";
}

function emitNumber(value: number, context: SourceContext, prefix: string, path: Array<string | number>): string {
  const variable = uniqueParamName(context, prefix, path);
  context.constants.push(`const ${variable} = ${formatNumber(value)};`);
  return variable;
}

function uniqueParamName(context: SourceContext, prefix: string, path: Array<string | number>): string {
  const base = `${prefix}_${path.map(formatPathPart).join("_") || "value"}`;
  let name = base;
  let suffix = 2;
  while (context.emittedParams.has(name)) {
    name = `${base}_${suffix}`;
    suffix += 1;
  }
  context.emittedParams.add(name);
  return name;
}

function formatPathPart(part: string | number): string {
  if (typeof part === "number") return String(part);
  return part.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "value";
}

function formatObjectKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Object.is(value, -0)) return "0";
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}
