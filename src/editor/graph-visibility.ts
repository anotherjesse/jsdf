import type { Node } from "../core/nodes";

export type GraphVisibilityState = "root" | "visible" | "hidden" | "inherited";

export interface GraphVisibilityMeta {
  state: GraphVisibilityState;
  title: string;
  disabled: boolean;
  pressed: boolean;
}

export interface GraphVisibilityPathState {
  isRoot: boolean;
  directlyHidden: boolean;
  inheritedHidden: boolean;
}

export function graphVisibilityMeta(
  isRoot: boolean,
  directlyHidden: boolean,
  inheritedHidden: boolean,
): GraphVisibilityMeta {
  if (isRoot) {
    return {
      state: "root",
      title: "Full shape stays visible",
      disabled: true,
      pressed: true,
    };
  }
  if (directlyHidden) {
    return {
      state: "hidden",
      title: "Show this shape in preview",
      disabled: false,
      pressed: false,
    };
  }
  if (inheritedHidden) {
    return {
      state: "inherited",
      title: "Parent is hidden; hide this shape too",
      disabled: false,
      pressed: true,
    };
  }
  return {
    state: "visible",
    title: "Hide this shape in preview",
    disabled: false,
    pressed: true,
  };
}

export function renderEyeIcon(state: GraphVisibilityState): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "eye-icon";
  icon.dataset.state = state;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function findGraphNode(root: Node | null, id: number, visited = new Set<number>()): Node | null {
  if (!root) return null;
  if (root.id === id) return root;
  if (visited.has(root.id)) return null;
  visited.add(root.id);
  for (const child of root.children) {
    const match = findGraphNode(child.node, id, visited);
    if (match) return match;
  }
  return null;
}

export function graphNodePath(root: Node | null, id: number): Node[] {
  if (!root) return [];
  const path: Node[] = [];
  const visit = (node: Node): boolean => {
    path.push(node);
    if (node.id === id) return true;
    for (const child of node.children) {
      if (visit(child.node)) return true;
    }
    path.pop();
    return false;
  };
  visit(root);
  return path;
}

export function graphVisibilityStateForPath(
  root: Node | null,
  hiddenNodeIds: ReadonlySet<number>,
  node: Node,
  path: readonly Node[],
): GraphVisibilityPathState {
  const isRoot = root?.id === node.id;
  const directlyHidden = hiddenNodeIds.has(node.id);
  const inheritedHidden = path.slice(0, -1).some((ancestor) => hiddenNodeIds.has(ancestor.id));
  return { isRoot, directlyHidden, inheritedHidden };
}

export function hiddenNodeIdsForIsolatedGraphNode(root: Node | null, node: Node): Set<number> {
  const hidden = new Set<number>();
  if (!root || root.id === node.id) return hidden;

  const allowed = new Set<number>();
  for (const pathNode of graphNodePath(root, node.id)) allowed.add(pathNode.id);
  collectGraphSubtreeNodeIds(node, allowed);

  const visit = (candidate: Node) => {
    if (candidate.id !== root.id && !allowed.has(candidate.id)) {
      hidden.add(candidate.id);
      return;
    }
    for (const child of candidate.children) visit(child.node);
  };

  visit(root);
  return hidden;
}

export function effectiveVisibleGraphNodeIds(root: Node | null, hiddenNodeIds: ReadonlySet<number>): Set<number> {
  const out = new Set<number>();
  if (!root) return out;

  const visit = (node: Node) => {
    if (hiddenNodeIds.has(node.id)) return;
    out.add(node.id);
    for (const child of node.children) visit(child.node);
  };
  visit(root);
  return out;
}

export function collectGraphSubtreeNodeIds(node: Node, out: Set<number>): void {
  out.add(node.id);
  for (const child of node.children) collectGraphSubtreeNodeIds(child.node, out);
}

export function graphNodeIdSetsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}
