import type { Node, SDF3 } from "../core/nodes";
import { UP, X, Y, Z, rotateToMatrix } from "../core/math";
import type { ParamPath, ParamValue } from "./graph-inspector";

export interface GraphSourceEdit {
  nodeId: number;
  nodeKind: string;
  path: ParamPath;
  label: string;
}

interface CallPatch {
  fn: string;
  arg: number;
}

const CALL_PATCHES: Record<string, Record<string, CallPatch>> = {
  sphere: { radius: { fn: "sphere", arg: 0 } },
  cylinder: { radius: { fn: "cylinder", arg: 0 } },
  roundedCylinder: {
    ra: { fn: "rounded_cylinder", arg: 0 },
    rb: { fn: "rounded_cylinder", arg: 1 },
    h: { fn: "rounded_cylinder", arg: 2 },
  },
  roundedBox: { radius: { fn: "rounded_box", arg: 1 } },
  torus: {
    r1: { fn: "torus", arg: 0 },
    r2: { fn: "torus", arg: 1 },
  },
  capsule: { radius: { fn: "capsule", arg: 2 } },
  cappedCylinder: { radius: { fn: "capped_cylinder", arg: 2 } },
  cappedCone: {
    ra: { fn: "capped_cone", arg: 2 },
    rb: { fn: "capped_cone", arg: 3 },
  },
  roundedCone: {
    r1: { fn: "rounded_cone", arg: 0 },
    r2: { fn: "rounded_cone", arg: 1 },
    h: { fn: "rounded_cone", arg: 2 },
  },
  ellipsoid: { "size[0]": { fn: "ellipsoid", arg: 0 } },
  pyramid: { h: { fn: "pyramid", arg: 0 } },
  tetrahedron: { r: { fn: "tetrahedron", arg: 0 } },
  octahedron: { r: { fn: "octahedron", arg: 0 } },
  dodecahedron: { r: { fn: "dodecahedron", arg: 0 } },
  icosahedron: { r: { fn: "icosahedron", arg: 0 } },
};

export function patchGraphEditSource(source: string, sdf: SDF3, edit: GraphSourceEdit, value: ParamValue): string | null {
  if (edit.nodeKind === "rotate3" && edit.label === "axis") {
    return patchOrientSource(source, sdf, edit, value);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const patch = CALL_PATCHES[edit.nodeKind]?.[edit.label];
  if (!patch) return null;
  const ordinal = ordinalForEdit(sdf.node, edit);
  if (ordinal < 0) return null;
  return patchNthCallArgument(source, patch, ordinal, value);
}

function patchOrientSource(source: string, sdf: SDF3, edit: GraphSourceEdit, value: ParamValue): string | null {
  const axis = axisForMatrix(value);
  if (!axis) return null;
  const ordinal = orientOrdinalForEdit(sdf.node, edit);
  if (ordinal < 0) return null;
  return patchNthOrientArgument(source, ordinal, axis);
}

function ordinalForEdit(root: Node, edit: GraphSourceEdit): number {
  const nodes = collectNodes(root)
    .filter((node) => node.kind === edit.nodeKind && hasParamLabel(node, edit.label))
    .sort((a, b) => a.id - b.id);
  return nodes.findIndex((node) => node.id === edit.nodeId);
}

function collectNodes(root: Node): Node[] {
  const out: Node[] = [];
  const visited = new Set<number>();
  const visit = (node: Node) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    out.push(node);
    for (const child of node.children) visit(child.node);
  };
  visit(root);
  return out;
}

function orientOrdinalForEdit(root: Node, edit: GraphSourceEdit): number {
  const nodes = collectNodes(root)
    .filter((node) => node.kind === "rotate3" && axisForMatrix(node.params.matrix))
    .sort((a, b) => a.id - b.id);
  return nodes.findIndex((node) => node.id === edit.nodeId);
}

function hasParamLabel(node: Node, label: string): boolean {
  let value: unknown = node.params;
  for (const part of labelToPath(label)) {
    value = Array.isArray(value)
      ? value[part as number]
      : (value as Record<string, unknown> | undefined)?.[part as string];
  }
  return typeof value === "number";
}

function labelToPath(label: string): ParamPath {
  const path: ParamPath = [];
  for (const part of label.split(".")) {
    const match = /^([^\[]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) {
      path.push(part);
      continue;
    }
    path.push(match[1]);
    for (const index of match[2].matchAll(/\[(\d+)\]/g)) {
      path.push(Number(index[1]));
    }
  }
  return path;
}

function patchNthCallArgument(source: string, patch: CallPatch, ordinal: number, value: number): string | null {
  const calls = findCalls(source, patch.fn);
  const call = calls[ordinal];
  if (!call) return null;
  const arg = call.args[patch.arg];
  if (!arg || !isNumericLiteral(arg.text)) return null;
  return `${source.slice(0, arg.start)}${formatNumber(value)}${source.slice(arg.end)}`;
}

function patchNthOrientArgument(source: string, ordinal: number, axis: OrientationAxis): string | null {
  const calls = findCalls(source, "orient");
  const call = calls[ordinal];
  if (!call || call.args.length === 0) return null;
  const arg = call.args[0];
  if (!isAxisExpression(arg.text)) return null;
  return `${source.slice(0, arg.start)}${axis.toUpperCase()}${source.slice(arg.end)}`;
}

interface CallArg {
  start: number;
  end: number;
  text: string;
}

interface CallMatch {
  args: CallArg[];
}

function findCalls(source: string, fn: string): CallMatch[] {
  const calls: CallMatch[] = [];
  const pattern = new RegExp(`\\b${escapeRegExp(fn)}\\s*\\(`, "g");
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const open = source.indexOf("(", match.index);
    const close = findMatchingParen(source, open);
    if (close < 0) continue;
    calls.push({ args: splitArgs(source, open + 1, close) });
    pattern.lastIndex = close + 1;
  }
  return calls;
}

function findMatchingParen(source: string, open: number): number {
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

function splitArgs(source: string, start: number, end: number): CallArg[] {
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

function isNumericLiteral(value: string): boolean {
  return /^\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value);
}

type OrientationAxis = "x" | "y" | "z";

function axisForMatrix(value: ParamValue): OrientationAxis | null {
  const matrix = matrixParam(value);
  if (!matrix) return null;
  for (const axis of ["x", "y", "z"] as OrientationAxis[]) {
    if (matricesClose(matrix, orientationMatrix(axis))) return axis;
  }
  return null;
}

function matrixParam(value: ParamValue): number[][] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const rows = value.map((row) => Array.isArray(row) ? row.map(Number) : []);
  if (!rows.every((row) => row.length === 3 && row.every(Number.isFinite))) return null;
  return rows;
}

function orientationMatrix(axis: OrientationAxis): number[][] {
  const target = axis === "x" ? X : axis === "y" ? Y : Z;
  return rotateToMatrix(UP, target);
}

function matricesClose(a: number[][], b: number[][]): boolean {
  return a.length === b.length && a.every((row, rowIndex) => {
    return row.length === b[rowIndex].length && row.every((item, columnIndex) => {
      return Math.abs(item - b[rowIndex][columnIndex]) < 1e-9;
    });
  });
}

function isAxisExpression(value: string): boolean {
  return /^\s*[XYZ]\s*$/.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) return "0";
  return String(Number(value.toPrecision(12)));
}
