import type { GraphSourceLink } from "./clean-source-patch";

export interface GraphNodeSourceIdentity {
  nodeKind: string;
  callOrdinal: number;
}

export function graphNodeSourceIdentityForNode(
  links: readonly GraphSourceLink[],
  nodeId: number,
): GraphNodeSourceIdentity | null {
  const calls = graphCallLinks(links);
  const selected = calls.find((link) => link.nodeId === nodeId);
  if (!selected) return null;

  const callOrdinal = calls
    .filter((link) => link.nodeKind === selected.nodeKind)
    .findIndex((link) => link.nodeId === selected.nodeId && link.start === selected.start && link.end === selected.end);

  return callOrdinal >= 0 ? { nodeKind: selected.nodeKind, callOrdinal } : null;
}

export function sourceLinkForGraphNodeIdentity(
  links: readonly GraphSourceLink[],
  identity: GraphNodeSourceIdentity,
): GraphSourceLink | null {
  return graphCallLinks(links)
    .filter((link) => link.nodeKind === identity.nodeKind)[identity.callOrdinal] ?? null;
}

function graphCallLinks(links: readonly GraphSourceLink[]): GraphSourceLink[] {
  return links
    .filter((link) => link.label === "call" && link.end > link.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}
