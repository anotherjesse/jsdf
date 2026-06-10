import { SDF2, SDF3, type Node, type NodeKind, type SDF } from "../core/nodes";

const CONTEXT_WRAPPERS = new Set<NodeKind>([
  "negate",
  "dilate",
  "erode",
  "shell",
  "repeat",
  "translate",
  "scale",
  "rotate2",
  "rotate3",
  "circularArray2",
  "circularArray3",
  "elongate2",
  "elongate3",
  "twist",
  "bend",
  "bendLinear",
  "bendRadial",
  "wrapAround",
  "extrude",
  "revolve",
]);

export interface SoloPreview {
  key: string;
  sdf: SDF3;
  node: Node;
  label: string;
  preservedWrappers: number;
}

export function buildSoloPreview(path: readonly Node[]): SoloPreview | null {
  const target = path.at(-1);
  if (!target) return null;

  let current = cloneSdfFromNode(target);
  let preservedWrappers = 0;
  for (let i = path.length - 2; i >= 0; i -= 1) {
    const parent = path[i];
    const child = path[i + 1];
    const childIndex = parent.children.findIndex((candidate) => candidate.node.id === child.id);
    if (!canPreserveContext(parent, childIndex)) continue;
    current = wrapContext(parent, current);
    preservedWrappers += 1;
  }

  if (!(current instanceof SDF3)) return null;
  return {
    key: path.map((node) => node.id).join("/"),
    sdf: current,
    node: target,
    label: `${target.kind} #${target.id}`,
    preservedWrappers,
  };
}

function canPreserveContext(parent: Node, childIndex: number): boolean {
  return childIndex === 0 && parent.children.length === 1 && CONTEXT_WRAPPERS.has(parent.kind);
}

function wrapContext(parent: Node, child: SDF): SDF {
  return wrapNode({
    id: parent.id,
    dim: parent.dim,
    kind: parent.kind,
    params: parent.params,
    children: [child],
  });
}

function cloneSdfFromNode(node: Node): SDF {
  return wrapNode({
    id: node.id,
    dim: node.dim,
    kind: node.kind,
    params: node.params,
    children: node.children.map((child) => cloneSdfFromNode(child.node)),
  });
}

function wrapNode(node: Node): SDF {
  return node.dim === 2 ? new SDF2(node) : new SDF3(node);
}
