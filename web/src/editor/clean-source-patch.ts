import type { Node, SDF3 } from "../core/nodes";
import { UP, X, Y, Z, rotateToMatrix } from "../core/math";
import type { ParamPath, ParamValue } from "./graph-inspector";
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

interface CallPatch {
  fns: string[];
  arg: number;
  element?: number;
}

const patch = (fns: string | string[], arg: number, element?: number): CallPatch => ({
  fns: Array.isArray(fns) ? fns : [fns],
  arg,
  ...(element == null ? {} : { element }),
});

const CALL_PATCHES: Record<string, Record<string, CallPatch>> = {
  circle: {
    radius: patch("circle", 0),
    "center[0]": patch("circle", 1, 0),
    "center[1]": patch("circle", 1, 1),
  },
  line: {
    "normal[0]": patch("line", 0, 0),
    "normal[1]": patch("line", 0, 1),
    "point[0]": patch("line", 1, 0),
    "point[1]": patch("line", 1, 1),
  },
  rectangle: {
    "size[0]": patch("rectangle", 0, 0),
    "size[1]": patch("rectangle", 0, 1),
    "center[0]": patch("rectangle", 1, 0),
    "center[1]": patch("rectangle", 1, 1),
  },
  roundedRectangle: {
    "size[0]": patch("rounded_rectangle", 0, 0),
    "size[1]": patch("rounded_rectangle", 0, 1),
    "radius[0]": patch("rounded_rectangle", 1, 0),
    "radius[1]": patch("rounded_rectangle", 1, 1),
    "radius[2]": patch("rounded_rectangle", 1, 2),
    "radius[3]": patch("rounded_rectangle", 1, 3),
    "center[0]": patch("rounded_rectangle", 2, 0),
    "center[1]": patch("rounded_rectangle", 2, 1),
  },
  hexagon: { r: patch("hexagon", 0) },
  roundedX: {
    w: patch("rounded_x", 0),
    r: patch("rounded_x", 1),
  },
  vesica: {
    r: patch("vesica", 0),
    d: patch("vesica", 1),
  },
  sphere: {
    radius: patch("sphere", 0),
    "center[0]": patch("sphere", 1, 0),
    "center[1]": patch("sphere", 1, 1),
    "center[2]": patch("sphere", 1, 2),
  },
  plane: {
    "normal[0]": patch("plane", 0, 0),
    "normal[1]": patch("plane", 0, 1),
    "normal[2]": patch("plane", 0, 2),
    "point[0]": patch("plane", 1, 0),
    "point[1]": patch("plane", 1, 1),
    "point[2]": patch("plane", 1, 2),
  },
  box: {
    "size[0]": patch("box", 0, 0),
    "size[1]": patch("box", 0, 1),
    "size[2]": patch("box", 0, 2),
    "center[0]": patch("box", 1, 0),
    "center[1]": patch("box", 1, 1),
    "center[2]": patch("box", 1, 2),
  },
  roundedBox: {
    "size[0]": patch("rounded_box", 0, 0),
    "size[1]": patch("rounded_box", 0, 1),
    "size[2]": patch("rounded_box", 0, 2),
    radius: patch("rounded_box", 1),
  },
  wireframeBox: {
    "size[0]": patch("wireframe_box", 0, 0),
    "size[1]": patch("wireframe_box", 0, 1),
    "size[2]": patch("wireframe_box", 0, 2),
    thickness: patch("wireframe_box", 1),
  },
  cylinder: { radius: patch("cylinder", 0) },
  roundedCylinder: {
    ra: patch("rounded_cylinder", 0),
    rb: patch("rounded_cylinder", 1),
    h: patch("rounded_cylinder", 2),
  },
  cappedCylinder: {
    "a[0]": patch("capped_cylinder", 0, 0),
    "a[1]": patch("capped_cylinder", 0, 1),
    "a[2]": patch("capped_cylinder", 0, 2),
    "b[0]": patch("capped_cylinder", 1, 0),
    "b[1]": patch("capped_cylinder", 1, 1),
    "b[2]": patch("capped_cylinder", 1, 2),
    radius: patch("capped_cylinder", 2),
  },
  torus: {
    r1: patch("torus", 0),
    r2: patch("torus", 1),
  },
  capsule: {
    "a[0]": patch("capsule", 0, 0),
    "a[1]": patch("capsule", 0, 1),
    "a[2]": patch("capsule", 0, 2),
    "b[0]": patch("capsule", 1, 0),
    "b[1]": patch("capsule", 1, 1),
    "b[2]": patch("capsule", 1, 2),
    radius: patch("capsule", 2),
  },
  cappedCone: {
    "a[0]": patch("capped_cone", 0, 0),
    "a[1]": patch("capped_cone", 0, 1),
    "a[2]": patch("capped_cone", 0, 2),
    "b[0]": patch("capped_cone", 1, 0),
    "b[1]": patch("capped_cone", 1, 1),
    "b[2]": patch("capped_cone", 1, 2),
    ra: patch("capped_cone", 2),
    rb: patch("capped_cone", 3),
  },
  roundedCone: {
    r1: patch("rounded_cone", 0),
    r2: patch("rounded_cone", 1),
    h: patch("rounded_cone", 2),
  },
  ellipsoid: {
    "size[0]": patch("ellipsoid", 0, 0),
    "size[1]": patch("ellipsoid", 0, 1),
    "size[2]": patch("ellipsoid", 0, 2),
  },
  pyramid: { h: patch("pyramid", 0) },
  tetrahedron: { r: patch("tetrahedron", 0) },
  octahedron: { r: patch("octahedron", 0) },
  dodecahedron: { r: patch("dodecahedron", 0) },
  icosahedron: { r: patch("icosahedron", 0) },
  dilate: { r: patch("dilate", 0) },
  erode: { r: patch("erode", 0) },
  shell: { thickness: patch("shell", 0) },
  translate: {
    "offset[0]": patch("translate", 0, 0),
    "offset[1]": patch("translate", 0, 1),
    "offset[2]": patch("translate", 0, 2),
  },
  scale: {
    "factor[0]": patch("scale", 0, 0),
    "factor[1]": patch("scale", 0, 1),
    "factor[2]": patch("scale", 0, 2),
  },
  circularArray2: { count: patch(["circular_array", "circularArray"], 0) },
  circularArray3: {
    count: patch(["circular_array", "circularArray"], 0),
    offset: patch(["circular_array", "circularArray"], 1),
  },
  elongate2: {
    "size[0]": patch("elongate", 0, 0),
    "size[1]": patch("elongate", 0, 1),
  },
  elongate3: {
    "size[0]": patch("elongate", 0, 0),
    "size[1]": patch("elongate", 0, 1),
    "size[2]": patch("elongate", 0, 2),
  },
  twist: { k: patch("twist", 0) },
  bend: { k: patch("bend", 0) },
  bendLinear: {
    "p0[0]": patch(["bend_linear", "bendLinear"], 0, 0),
    "p0[1]": patch(["bend_linear", "bendLinear"], 0, 1),
    "p0[2]": patch(["bend_linear", "bendLinear"], 0, 2),
    "p1[0]": patch(["bend_linear", "bendLinear"], 1, 0),
    "p1[1]": patch(["bend_linear", "bendLinear"], 1, 1),
    "p1[2]": patch(["bend_linear", "bendLinear"], 1, 2),
  },
  bendRadial: {
    r0: patch(["bend_radial", "bendRadial"], 0),
    r1: patch(["bend_radial", "bendRadial"], 1),
    dz: patch(["bend_radial", "bendRadial"], 2),
  },
  transitionLinear: {
    "p0[0]": patch(["transition_linear", "transitionLinear"], 1, 0),
    "p0[1]": patch(["transition_linear", "transitionLinear"], 1, 1),
    "p0[2]": patch(["transition_linear", "transitionLinear"], 1, 2),
    "p1[0]": patch(["transition_linear", "transitionLinear"], 2, 0),
    "p1[1]": patch(["transition_linear", "transitionLinear"], 2, 1),
    "p1[2]": patch(["transition_linear", "transitionLinear"], 2, 2),
  },
  transitionRadial: {
    r0: patch(["transition_radial", "transitionRadial"], 1),
    r1: patch(["transition_radial", "transitionRadial"], 2),
  },
  wrapAround: {
    x0: patch(["wrap_around", "wrapAround"], 0),
    x1: patch(["wrap_around", "wrapAround"], 1),
    r: patch(["wrap_around", "wrapAround"], 2),
  },
  repeat: {
    "spacing[0]": patch("repeat", 0, 0),
    "spacing[1]": patch("repeat", 0, 1),
    "spacing[2]": patch("repeat", 0, 2),
    "count[0]": patch("repeat", 1, 0),
    "count[1]": patch("repeat", 1, 1),
    "count[2]": patch("repeat", 1, 2),
    "padding[0]": patch("repeat", 2, 0),
    "padding[1]": patch("repeat", 2, 1),
    "padding[2]": patch("repeat", 2, 2),
  },
  extrude: { h: patch("extrude", 0) },
  extrudeTo: { h: patch(["extrude_to", "extrudeTo"], 1) },
  revolve: { offset: patch("revolve", 0) },
};

const EXTRA_NODE_CALLS: Record<string, string[]> = {
  blend: ["blend"],
  difference: ["difference", "subtract"],
  equilateralTriangle: ["equilateral_triangle", "equilateralTriangle"],
  intersection: ["intersection"],
  negate: ["negate"],
  polygon: ["polygon"],
  rotate2: ["rotate"],
  rotate3: ["rotate", "rotate_to", "rotateTo", "orient"],
  slice: ["slice"],
  union: ["union"],
};

const CSG_NODE_KINDS = new Set(["union", "difference", "intersection", "blend"]);

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

  const scalarVectorLinks = new Set<string>();
  for (const [nodeKind, labels] of Object.entries(CALL_PATCHES)) {
    for (const [label, patch] of Object.entries(labels)) {
      const nodes = patchableNodes(sdf.node, nodeKind, label);
      nodes.forEach((node, ordinal) => {
        const range = findNthCallArgumentRange(source, patch, ordinal);
        if (!range) return;
        if (range.scalarVector) {
          const key = `${node.id}:${range.start}:${range.end}`;
          if (scalarVectorLinks.has(key)) return;
          scalarVectorLinks.add(key);
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
  if (!range) return null;
  if (range.scalarVector) {
    const vector = vectorValueForLabel(node, label);
    if (!vector) return null;
    return replaceRange(source, range.start, range.end, `[${vector.map(formatNumber).join(", ")}]`);
  }
  return replaceRange(source, range.start, range.end, formatNumberLike(source.slice(range.start, range.end), value));
}

function findNthCallArgumentRange(source: string, patch: CallPatch, ordinal: number): SourceRange | null {
  const calls = findCalls(source, patch.fns);
  const call = calls[ordinal];
  if (!call) return null;
  if (patch.element == null) {
    return numericArgRange(source, call, patch.arg);
  }
  const arg = call.args[patch.arg];
  if (!arg) return null;
  return findVectorElementRange(source, arg, patch.element);
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
  return findArrayElementRange(source, arg, element) ?? findAxisScaledElementRange(arg, element) ?? findScalarVectorRange(source, arg);
}

function findArrayElementRange(source: string, arg: CallArg, element: number): SourceRange | null {
  const open = firstNonWhitespace(source, arg.start, arg.end);
  if (open < 0 || source[open] !== "[") return null;
  const close = findMatchingParen(source, open);
  if (close < 0 || close > arg.end) return null;
  if (source.slice(arg.start, open).trim() || source.slice(close + 1, arg.end).trim()) return null;

  const elements = splitArgs(source, open + 1, close);
  const target = elements[element];
  if (!target || !isNumericLiteral(target.text)) return null;
  return trimRange(source, target.start, target.end);
}

function findAxisScaledElementRange(arg: CallArg, element: number): SourceRange | null {
  const match = /^(\s*mul\(\s*([XYZ])\s*,\s*)(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(\s*\)\s*)$/i.exec(arg.text);
  if (!match) return null;
  if (axisElement(match[2].toUpperCase()) !== element) return null;
  const start = arg.start + match[1].length;
  const end = start + match[3].length;
  return { start, end };
}

function findScalarVectorRange(source: string, arg: CallArg): SourceRange | null {
  if (!isNumericLiteral(arg.text)) return null;
  return { ...trimRange(source, arg.start, arg.end), scalarVector: true };
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
