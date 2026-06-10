import type { Node } from "../core/nodes";

export interface GraphNodeView {
  node: Node;
  depth: number;
  parents: Set<number>;
  childIds: number[];
  matched: boolean;
}

export interface GraphEdgeView {
  from: number;
  to: number;
}

export interface GraphModel {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  nodeById: Map<number, GraphNodeView>;
  maxDepth: number;
  visibleNodeIds: Set<number>;
}

export function buildGraphModel(root: Node, filter: string): GraphModel {
  const query = filter.trim().toLowerCase();
  const nodeById = new Map<number, GraphNodeView>();
  const edgeKeys = new Set<string>();
  const edges: GraphEdgeView[] = [];

  const visit = (node: Node, depth: number, parentId: number | null) => {
    let view = nodeById.get(node.id);
    if (!view) {
      view = {
        node,
        depth,
        parents: new Set<number>(),
        childIds: node.children.map((child) => child.node.id),
        matched: matchesNode(node, query),
      };
      nodeById.set(node.id, view);
    } else {
      view.depth = Math.min(view.depth, depth);
    }

    if (parentId != null) {
      view.parents.add(parentId);
      const key = `${parentId}:${node.id}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push({ from: parentId, to: node.id });
      }
    }

    for (const child of node.children) visit(child.node, depth + 1, node.id);
  };

  visit(root, 0, null);

  const visibleNodeIds = query ? matchingNeighborhood(nodeById) : new Set(nodeById.keys());
  const nodes = [...nodeById.values()].sort((a, b) => a.depth - b.depth || a.node.id - b.node.id);
  const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), 0);
  return { nodes, edges, nodeById, maxDepth, visibleNodeIds };
}

export function childMatchesFilter(node: Node, visibleNodeIds: Set<number>): boolean {
  return visibleNodeIds.has(node.id) || node.children.some((child) => childMatchesFilter(child.node, visibleNodeIds));
}

function matchingNeighborhood(nodeById: Map<number, GraphNodeView>): Set<number> {
  const out = new Set<number>();
  const includeAncestors = (id: number) => {
    if (out.has(id)) return;
    out.add(id);
    for (const parentId of nodeById.get(id)?.parents ?? []) includeAncestors(parentId);
  };

  for (const view of nodeById.values()) {
    if (!view.matched) continue;
    includeAncestors(view.node.id);
    for (const childId of view.childIds) out.add(childId);
  }
  return out;
}

function matchesNode(node: Node, query: string): boolean {
  if (!query) return true;
  if (node.kind.toLowerCase().includes(query)) return true;
  if (`#${node.id}`.includes(query) || String(node.id).includes(query)) return true;
  return Object.entries(node.params).some(([key, value]) => {
    return key.toLowerCase().includes(query) || String(value).toLowerCase().includes(query);
  });
}
