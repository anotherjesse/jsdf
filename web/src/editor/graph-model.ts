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
  const terms = query ? query.split(/\s+/).filter(Boolean) : [];
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
        matched: matchesNode(node, terms),
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

function matchesNode(node: Node, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const text = searchableNodeText(node);
  return terms.every((term) => text.includes(term));
}

function searchableNodeText(node: Node): string {
  const parts = [
    node.kind,
    `#${node.id}`,
    String(node.id),
    `${node.dim}d`,
  ];
  collectParamSearchParts(node.params, [], parts);
  return parts.join(" ").toLowerCase();
}

function collectParamSearchParts(value: unknown, path: Array<string | number>, parts: string[]): void {
  if (path.length > 0) parts.push(formatParamPath(path));
  if (value == null) {
    parts.push(String(value));
    return;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    parts.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "number" || typeof item === "string" || typeof item === "boolean" || item == null)) {
      parts.push(value.map(String).join(","));
      parts.push(value.map(String).join(", "));
    }
    value.forEach((item, index) => collectParamSearchParts(item, [...path, index], parts));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "ease") continue;
      parts.push(key);
      collectParamSearchParts(item, [...path, key], parts);
    }
  }
}

function formatParamPath(path: Array<string | number>): string {
  return path.map((part, index) => {
    if (typeof part === "number") return `[${part}]`;
    return index === 0 ? part : `.${part}`;
  }).join("");
}
