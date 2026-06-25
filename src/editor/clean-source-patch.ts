import type { Node, SDF3 } from "../core/nodes";
import { UP, X, Y, Z, rotateToMatrix } from "../core/math";
import type { ParamPath, ParamValue } from "./graph-edit-model";
import { CALL_PATCHES, CSG_NODE_KINDS, EXTRA_NODE_CALLS, type CallPatch } from "./graph-source-patch-table";
import {
  findCalls,
  findMatchingParen,
  firstNonWhitespace,
  isNumericLiteral,
  numericArgRange,
  splitArgs,
  trimRange,
  type CallArg,
  type CallMatch,
  type SourceRange,
} from "./source-parser";

export interface GraphSourceEdit {
  nodeId: number;
  nodeKind: string;
  path: ParamPath;
  label: string;
}

export interface GraphSourceLink extends GraphSourceEdit {
  start: number;
  end: number;
  scrubbable?: boolean;
}

export function patchGraphEditSource(source: string, sdf: SDF3, edit: GraphSourceEdit, value: ParamValue): string | null {
  if (edit.nodeKind === "rotate3" && edit.label === "axis") {
    return patchOrientSource(source, sdf, edit, value);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (isEntryKEdit(edit)) {
    return patchEntryKSource(source, sdf, edit, value);
  }
  const patch = CALL_PATCHES[edit.nodeKind]?.[edit.label];
  if (!patch) return null;
  const nodes = patchableNodes(sdf.node, edit.nodeKind, edit.label);
  const ordinal = nodes.findIndex((node) => node.id === edit.nodeId);
  if (ordinal < 0) return null;
  return patchNthCallArgument(source, patch, ordinal, value, nodes[ordinal], edit.label);
}

export function findGraphSourceLinks(source: string, sdf: SDF3): GraphSourceLink[] {
  const links: GraphSourceLink[] = [];
  links.push(...findGraphCallLinks(source, sdf));
  links.push(...findGraphEntryKLinks(source, sdf));

  const vectorExpressionLinks = new Set<string>();
  for (const [nodeKind, labels] of Object.entries(CALL_PATCHES)) {
    for (const [label, patch] of Object.entries(labels)) {
      const nodes = patchableNodes(sdf.node, nodeKind, label);
      nodes.forEach((node, ordinal) => {
        const range = findNthCallArgumentRange(source, patch, ordinal);
        if (!range) {
          if (patch.element == null) return;
          const vectorRange = findNthCallArgumentVectorRange(source, patch, ordinal);
          if (!vectorRange) return;
          const key = `${node.id}:${vectorRange.start}:${vectorRange.end}`;
          if (vectorExpressionLinks.has(key)) return;
          vectorExpressionLinks.add(key);
          links.push({
            nodeId: node.id,
            nodeKind,
            path: vectorBasePath(label),
            label: vectorBaseLabel(label),
            start: vectorRange.start,
            end: vectorRange.end,
            scrubbable: false,
          });
          return;
        }
        if (range.scalarVector) {
          const key = `${node.id}:${range.start}:${range.end}`;
          if (vectorExpressionLinks.has(key)) return;
          vectorExpressionLinks.add(key);
          links.push({
            nodeId: node.id,
            nodeKind,
            path: vectorBasePath(label),
            label: vectorBaseLabel(label),
            start: range.start,
            end: range.end,
            scrubbable: false,
          });
          return;
        }
        links.push({
          nodeId: node.id,
          nodeKind,
          path: labelToPath(label),
          label,
          ...range,
        });
      });
    }
  }

  const orientNodes = orientPatchableNodes(sdf.node);
  orientNodes.forEach((node, ordinal) => {
    const range = findNthOrientArgumentRange(source, ordinal);
    if (!range) return;
    links.push({
      nodeId: node.id,
      nodeKind: "rotate3",
      path: ["matrix"],
      label: "axis",
      ...range,
    });
  });

  return links.sort((a, b) => a.start - b.start || a.end - b.end);
}

function findGraphCallLinks(source: string, sdf: SDF3): GraphSourceLink[] {
  const links: GraphSourceLink[] = [];
  const nodeKinds = new Set([...Object.keys(CALL_PATCHES), ...Object.keys(EXTRA_NODE_CALLS)]);
  for (const nodeKind of nodeKinds) {
    const fns = callFnsForNodeKind(nodeKind);
    if (fns.length === 0) continue;
    const nodes = collectNodes(sdf.node)
      .filter((node) => node.kind === nodeKind)
      .sort((a, b) => a.id - b.id);
    const calls = findCalls(source, fns);
    nodes.forEach((node, ordinal) => {
      const call = calls[ordinal];
      if (!call) return;
      links.push({
        nodeId: node.id,
        nodeKind,
        path: [],
        label: "call",
        start: call.nameStart,
        end: call.nameEnd,
        scrubbable: false,
      });
    });
  }
  return links;
}

function callFnsForNodeKind(nodeKind: string): string[] {
  const fns = new Set(EXTRA_NODE_CALLS[nodeKind] ?? []);
  for (const patch of Object.values(CALL_PATCHES[nodeKind] ?? {})) {
    for (const fn of patch.fns) fns.add(fn);
  }
  return [...fns];
}

function findGraphEntryKLinks(source: string, sdf: SDF3): GraphSourceLink[] {
  const links: GraphSourceLink[] = [];
  const calls = findKMethodCalls(source);
  entryKTargets(sdf.node).forEach((target, ordinal) => {
    const call = calls[ordinal];
    if (!call) return;
    const label = entryKLabel(target.entryIndex);
    links.push({
      nodeId: target.node.id,
      nodeKind: target.node.kind,
      path: ["entries", target.entryIndex, "k"],
      label,
      start: call.nameStart,
      end: call.nameEnd,
      scrubbable: false,
    });

    const range = numericArgRange(source, call, 0);
    if (!range) return;
    links.push({
      nodeId: target.node.id,
      nodeKind: target.node.kind,
      path: ["entries", target.entryIndex, "k"],
      label,
      ...range,
    });
  });
  return links;
}

function patchEntryKSource(source: string, sdf: SDF3, edit: GraphSourceEdit, value: number): string | null {
  const entryIndex = entryKIndex(edit);
  if (entryIndex == null) return null;
  const ordinal = entryKTargets(sdf.node).findIndex((target) => {
    return target.node.id === edit.nodeId && target.entryIndex === entryIndex;
  });
  if (ordinal < 0) return null;
  const call = findKMethodCalls(source)[ordinal];
  if (!call) return null;
  const range = numericArgRange(source, call, 0);
  if (!range) return null;
  return replaceRange(source, range.start, range.end, formatNumberLike(source.slice(range.start, range.end), Math.max(0, value)));
}

interface EntryKTarget {
  node: Node;
  entryIndex: number;
}

function entryKTargets(root: Node): EntryKTarget[] {
  const targets: EntryKTarget[] = [];
  for (const node of collectNodes(root).sort((a, b) => a.id - b.id)) {
    if (!CSG_NODE_KINDS.has(node.kind)) continue;
    const entries = node.params.entries;
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, entryIndex) => {
      const k = (entry as Record<string, unknown> | null | undefined)?.k;
      if (typeof k === "number" && Number.isFinite(k)) {
        targets.push({ node, entryIndex });
      }
    });
  }
  return targets;
}

function isEntryKEdit(edit: GraphSourceEdit): boolean {
  return entryKIndex(edit) != null && CSG_NODE_KINDS.has(edit.nodeKind);
}

function entryKIndex(edit: GraphSourceEdit): number | null {
  const [entries, index, k] = edit.path;
  return entries === "entries" && typeof index === "number" && k === "k" ? index : null;
}

function entryKLabel(entryIndex: number): string {
  return `entries[${entryIndex}].k`;
}

function patchOrientSource(source: string, sdf: SDF3, edit: GraphSourceEdit, value: ParamValue): string | null {
  const axis = axisForMatrix(value);
  if (!axis) return null;
  const ordinal = orientOrdinalForEdit(sdf.node, edit);
  if (ordinal < 0) return null;
  return patchNthOrientArgument(source, ordinal, axis);
}

function patchableNodes(root: Node, nodeKind: string, label: string): Node[] {
  return collectNodes(root)
    .filter((node) => node.kind === nodeKind && hasParamLabel(node, label))
    .sort((a, b) => a.id - b.id);
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
  const nodes = orientPatchableNodes(root);
  return nodes.findIndex((node) => node.id === edit.nodeId);
}

function orientPatchableNodes(root: Node): Node[] {
  return collectNodes(root)
    .filter((node) => node.kind === "rotate3" && axisForMatrix(node.params.matrix))
    .sort((a, b) => a.id - b.id);
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

function vectorBaseLabel(label: string): string {
  return label.replace(/\[\d+\]$/, "");
}

function vectorBasePath(label: string): ParamPath {
  const path = labelToPath(label);
  return typeof path.at(-1) === "number" ? path.slice(0, -1) : path;
}

function vectorValueForLabel(node: Node, label: string): number[] | null {
  const path = vectorBasePath(label);
  let value: unknown = node.params;
  for (const part of path) {
    value = Array.isArray(value)
      ? value[part as number]
      : (value as Record<string, unknown> | undefined)?.[part as string];
  }
  if (!Array.isArray(value)) return null;
  const vector = value.map(Number);
  return vector.every(Number.isFinite) ? vector : null;
}

function patchNthCallArgument(source: string, patch: CallPatch, ordinal: number, value: number, node: Node, label: string): string | null {
  const range = findNthCallArgumentRange(source, patch, ordinal);
  if (!range) {
    const materialized = materializeExistingVectorArgument(source, patch, ordinal, value, node, label);
    return materialized ?? materializeMissingCallArguments(source, patch, ordinal, node, label);
  }
  if (range.scalarVector) {
    const vector = vectorValueForLabel(node, label);
    if (!vector) return null;
    return replaceRange(source, range.start, range.end, `[${vector.map(formatNumber).join(", ")}]`);
  }
  return replaceRange(source, range.start, range.end, formatNumberLike(source.slice(range.start, range.end), value));
}

function materializeExistingVectorArgument(
  source: string,
  patch: CallPatch,
  ordinal: number,
  value: number,
  node: Node,
  label: string,
): string | null {
  if (patch.element == null) return null;
  const calls = findCalls(source, patch.fns);
  const call = calls[ordinal];
  const arg = call?.args[patch.arg];
  if (!arg) return null;

  const directAxis = directAxisArgument(arg);
  if (directAxis && axisElement(directAxis.axis) === patch.element) {
    return replaceRange(source, directAxis.start, directAxis.end, formatAxisVectorExpression(directAxis.axis, value));
  }

  const range = findVectorArgumentRange(source, arg);
  const vector = vectorValueForLabel(node, label);
  if (!range || !vector) return null;
  return replaceRange(source, range.start, range.end, `[${vector.map(formatNumber).join(", ")}]`);
}

function materializeMissingCallArguments(source: string, patch: CallPatch, ordinal: number, node: Node, label: string): string | null {
  const calls = findCalls(source, patch.fns);
  const call = calls[ordinal];
  if (!call || call.args.length > patch.arg) return null;

  const values: string[] = [];
  for (let arg = call.args.length; arg <= patch.arg; arg += 1) {
    const value = materializedArgumentValue(node, patch, arg, label);
    if (!value) return null;
    values.push(value);
  }
  return insertCallArguments(source, call, values);
}

function findNthCallArgumentRange(source: string, patch: CallPatch, ordinal: number): SourceRange | null {
  const calls = findCalls(source, patch.fns);
  const call = calls[ordinal];
  if (!call) return null;
  if (patch.element == null) {
    return numericArgRange(source, call, patch.arg) ?? numericConstArgRange(source, call.args[patch.arg]);
  }
  const arg = call.args[patch.arg];
  if (!arg) return null;
  return findVectorElementRange(source, arg, patch.element);
}

function findNthCallArgumentVectorRange(source: string, patch: CallPatch, ordinal: number): SourceRange | null {
  const calls = findCalls(source, patch.fns);
  const call = calls[ordinal];
  const arg = call?.args[patch.arg];
  return arg ? findVectorArgumentRange(source, arg) : null;
}

function patchNthOrientArgument(source: string, ordinal: number, axis: OrientationAxis): string | null {
  const range = findNthOrientArgumentRange(source, ordinal);
  if (!range) return null;
  return replaceRange(source, range.start, range.end, axis.toUpperCase());
}

function findNthOrientArgumentRange(source: string, ordinal: number): SourceRange | null {
  const calls = findCalls(source, "orient");
  const call = calls[ordinal];
  if (!call || call.args.length === 0) return null;
  const arg = call.args[0];
  return findAxisExpressionRange(arg);
}

function findKMethodCalls(source: string): CallMatch[] {
  return findCalls(source, "k").filter((call) => {
    const arg = call.args[0]?.text.trim();
    return source[call.nameStart - 1] === "." && arg !== undefined && arg !== "" && arg !== "null";
  });
}

function findVectorElementRange(source: string, arg: CallArg, element: number): SourceRange | null {
  return findArrayElementRange(source, arg, element)
    ?? findConstArrayElementRange(source, arg, element)
    ?? findAxisScaledElementRange(arg, element)
    ?? findScalarVectorRange(source, arg);
}

function findVectorArgumentRange(source: string, arg: CallArg): SourceRange | null {
  return findArrayArgumentRange(source, arg)
    ?? findAxisScaledArgumentRange(arg)
    ?? findDirectAxisArgumentRange(arg)
    ?? findScalarVectorRange(source, arg);
}

function materializedArgumentValue(node: Node, patch: CallPatch, arg: number, fallbackLabel: string): string | null {
  const candidates = Object.entries(CALL_PATCHES[node.kind] ?? {}).filter(([, candidate]) => {
    return candidate.arg === arg && candidate.fns.some((fn) => patch.fns.includes(fn));
  });
  const scalar = candidates.find(([, candidate]) => candidate.element == null);
  if (scalar) {
    const value = valueForLabel(node, scalar[0]);
    return typeof value === "number" && Number.isFinite(value) ? formatNumber(value) : null;
  }

  const vectorLabels = new Set(candidates.map(([candidateLabel]) => vectorBaseLabel(candidateLabel)));
  if (arg === patch.arg) vectorLabels.add(vectorBaseLabel(fallbackLabel));
  for (const vectorLabel of vectorLabels) {
    const vector = vectorValueForLabel(node, vectorLabel);
    if (vector) return `[${vector.map(formatNumber).join(", ")}]`;
  }
  return null;
}

function valueForLabel(node: Node, label: string): unknown {
  let value: unknown = node.params;
  for (const part of labelToPath(label)) {
    value = Array.isArray(value)
      ? value[part as number]
      : (value as Record<string, unknown> | undefined)?.[part as string];
  }
  return value;
}

function insertCallArguments(source: string, call: CallMatch, values: string[]): string | null {
  const open = source.indexOf("(", call.nameEnd);
  if (open < 0) return null;
  const close = findMatchingParen(source, open);
  if (close < 0) return null;
  const beforeClose = source.slice(0, close);
  const trailingWhitespace = beforeClose.match(/\s*$/)?.[0].length ?? 0;
  const insertAt = close - trailingWhitespace;
  const separator = call.args.length === 0 ? "" : ", ";
  return `${source.slice(0, insertAt)}${separator}${values.join(", ")}${source.slice(insertAt)}`;
}

function findArrayElementRange(source: string, arg: CallArg, element: number): SourceRange | null {
  const open = firstNonWhitespace(source, arg.start, arg.end);
  if (open < 0 || source[open] !== "[") return null;
  const close = findMatchingParen(source, open);
  if (close < 0 || close > arg.end) return null;
  if (source.slice(arg.start, open).trim() || source.slice(close + 1, arg.end).trim()) return null;

  const elements = splitArgs(source, open + 1, close);
  const target = elements[element];
  if (!target) return null;
  return isNumericLiteral(target.text)
    ? trimRange(source, target.start, target.end)
    : numericConstArgRange(source, target);
}

function findConstArrayElementRange(source: string, arg: CallArg, element: number): SourceRange | null {
  const identifier = arg.text.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) return null;
  return findNumericConstArrayElementRange(source, identifier, element, arg.start);
}

function findArrayArgumentRange(source: string, arg: CallArg): SourceRange | null {
  const open = firstNonWhitespace(source, arg.start, arg.end);
  if (open < 0 || source[open] !== "[") return null;
  const close = findMatchingParen(source, open);
  if (close < 0 || close > arg.end) return null;
  if (source.slice(arg.start, open).trim() || source.slice(close + 1, arg.end).trim()) return null;
  return trimRange(source, arg.start, arg.end);
}

function findAxisScaledElementRange(arg: CallArg, element: number): SourceRange | null {
  const match = /^(\s*mul\(\s*([XYZ])\s*,\s*)(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(\s*\)\s*)$/i.exec(arg.text);
  if (!match) return null;
  if (axisElement(match[2].toUpperCase()) !== element) return null;
  const start = arg.start + match[1].length;
  const end = start + match[3].length;
  return { start, end };
}

function findAxisScaledArgumentRange(arg: CallArg): SourceRange | null {
  return /^\s*mul\(\s*[XYZ]\s*,\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*\)\s*$/i.test(arg.text)
    ? { start: arg.start, end: arg.end }
    : null;
}

function findDirectAxisArgumentRange(arg: CallArg): SourceRange | null {
  const direct = directAxisArgument(arg);
  return direct ? { start: direct.start, end: direct.end } : null;
}

function directAxisArgument(arg: CallArg): { axis: string; start: number; end: number } | null {
  const direct = /^(\s*)([XYZ])(\s*)$/i.exec(arg.text);
  if (!direct) return null;
  const start = arg.start + direct[1].length;
  return { axis: direct[2].toUpperCase(), start, end: start + direct[2].length };
}

function findScalarVectorRange(source: string, arg: CallArg): SourceRange | null {
  if (!isNumericLiteral(arg.text)) return null;
  return { ...trimRange(source, arg.start, arg.end), scalarVector: true };
}

function numericConstArgRange(source: string, arg: CallArg | undefined): SourceRange | null {
  if (!arg) return null;
  const identifier = arg.text.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) return null;
  return findNumericConstValueRange(source, identifier, arg.start);
}

function findNumericConstValueRange(source: string, identifier: string, beforeOffset: number): SourceRange | null {
  const numberPattern = "-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
  const pattern = new RegExp(`\\bconst\\s+${escapeRegExp(identifier)}\\s*=\\s*(${numberPattern})`, "g");
  let found: SourceRange | null = null;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match.index >= beforeOffset) break;
    const start = match.index + match[0].length - match[1].length;
    found = { start, end: start + match[1].length };
  }
  return found;
}

function findNumericConstArrayElementRange(
  source: string,
  identifier: string,
  element: number,
  beforeOffset: number,
): SourceRange | null {
  const pattern = new RegExp(`\\bconst\\s+${escapeRegExp(identifier)}\\s*=\\s*\\[`, "g");
  let found: SourceRange | null = null;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match.index >= beforeOffset) break;
    const open = source.indexOf("[", match.index);
    if (open < 0) continue;
    const close = findMatchingParen(source, open);
    if (close < 0 || close >= beforeOffset) continue;
    const elements = splitArgs(source, open + 1, close);
    const target = elements[element];
    if (!target || !isNumericLiteral(target.text)) continue;
    found = trimRange(source, target.start, target.end);
  }
  return found;
}

function findAxisExpressionRange(arg: CallArg): SourceRange | null {
  const direct = /^(\s*)([XYZ])(\s*)$/i.exec(arg.text);
  if (direct) {
    const start = arg.start + direct[1].length;
    return { start, end: start + direct[2].length };
  }

  const scaled = /^(\s*mul\(\s*)([XYZ])(\s*,\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*\)\s*)$/i.exec(arg.text);
  if (!scaled) return null;
  const start = arg.start + scaled[1].length;
  return { start, end: start + scaled[2].length };
}

function axisElement(axis: string): number {
  if (axis === "X") return 0;
  if (axis === "Y") return 1;
  return 2;
}

function formatAxisVectorExpression(axis: string, value: number): string {
  return value === 1 ? axis : `mul(${axis}, ${formatNumber(value)})`;
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

function replaceRange(source: string, start: number, end: number, value: string): string {
  return `${source.slice(0, start)}${value}${source.slice(end)}`;
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) return "0";
  return String(Number(value.toPrecision(12)));
}

function formatNumberLike(previous: string, value: number): string {
  const match = /^(\s*)-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(\s*)$/i.exec(previous);
  return `${match?.[1] ?? ""}${formatNumber(value)}${match?.[2] ?? ""}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
