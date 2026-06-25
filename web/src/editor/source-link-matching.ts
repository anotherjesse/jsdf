import type { Node } from "../core/nodes";
import type { GraphSourceEdit, GraphSourceLink } from "./clean-source-patch";

export function sourceLinkForNodeId(links: readonly GraphSourceLink[], nodeId: number): GraphSourceLink | null {
  return links.find((link) => {
    return link.nodeId === nodeId && link.label === "call" && link.end > link.start;
  }) ?? links.find((link) => {
    return link.nodeId === nodeId && link.end > link.start;
  }) ?? null;
}

export function sourceLinkForGraphEdit(
  links: readonly GraphSourceLink[],
  edit: Pick<GraphSourceEdit, "nodeId" | "path">,
): GraphSourceLink | null {
  return links.find((link) => {
    return link.nodeId === edit.nodeId && link.end > link.start && sourcePathsEqual(link.path, edit.path);
  }) ?? links.find((link) => {
    return link.nodeId === edit.nodeId
      && link.end > link.start
      && link.scrubbable === false
      && sourcePathStartsWith(edit.path, link.path);
  }) ?? links.find((link) => {
    return link.nodeId === edit.nodeId && link.end > link.start;
  }) ?? null;
}

export function sourceLinksEqual(a: GraphSourceLink | null, b: GraphSourceLink | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.nodeId === b.nodeId
    && a.nodeKind === b.nodeKind
    && a.label === b.label
    && a.start === b.start
    && a.end === b.end
    && sourcePathsEqual(a.path, b.path);
}

export function sourcePathsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

export function sourcePathStartsWith(path: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

export function sourceLinkLabel(link: GraphSourceLink): string {
  return `${link.nodeKind} #${link.nodeId} ${link.label}`;
}

export function graphNodeLabel(node: Pick<Node, "kind" | "id">): string {
  return `${node.kind} #${node.id}`;
}
