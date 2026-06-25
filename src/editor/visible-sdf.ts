import { SDF2, SDF3, type Node, type SDF } from "../core/nodes";

const CSG_NODE_KINDS = new Set(["union", "difference", "intersection", "blend"]);

export function buildVisibleSdf(sdf: SDF3, hiddenNodeIds: ReadonlySet<number>): SDF3 | null {
  if (hiddenNodeIds.size === 0) return sdf;
  const node = cloneVisibleNode(sdf.node, hiddenNodeIds);
  return node && node.dim === 3 ? new SDF3(node) : null;
}

function cloneVisibleNode(node: Node, hiddenNodeIds: ReadonlySet<number>): Node | null {
  if (hiddenNodeIds.has(node.id)) return null;
  if (node.children.length === 0) return cloneNode(node, []);

  const visibleChildren: SDF[] = [];
  const visibleIndices: number[] = [];
  node.children.forEach((child, index) => {
    const visibleChild = cloneVisibleNode(child.node, hiddenNodeIds);
    if (!visibleChild) return;
    visibleChildren.push(wrapNode(visibleChild));
    visibleIndices.push(index);
  });

  if (visibleChildren.length === 0) return null;
  if (node.kind === "difference" && visibleIndices[0] !== 0) return null;
  if (CSG_NODE_KINDS.has(node.kind) && visibleChildren.length === 1) {
    return visibleChildren[0].node;
  }
  if (!CSG_NODE_KINDS.has(node.kind) && visibleChildren.length !== node.children.length) {
    return null;
  }

  return cloneNode(node, visibleChildren, visibleIndices);
}

function cloneNode(node: Node, children: SDF[], visibleIndices: number[] = children.map((_, index) => index)): Node {
  return {
    id: node.id,
    dim: node.dim,
    kind: node.kind,
    params: cloneParams(node.params, visibleIndices),
    children,
  };
}

function cloneParams(params: Record<string, unknown>, visibleIndices: number[]): Record<string, unknown> {
  const out = { ...params };
  const entries = params.entries;
  if (Array.isArray(entries)) {
    out.entries = visibleIndices.map((index) => entries[index]).filter(Boolean);
  }
  return out;
}

function wrapNode(node: Node): SDF {
  return node.dim === 2 ? new SDF2(node) : new SDF3(node);
}
