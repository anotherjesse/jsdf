import type { GraphSourceLink } from "./clean-source-patch";
import { sourcePathsEqual } from "./source-link-matching";

export interface GraphNodeSourceIdentity {
  nodeKind: string;
  callOrdinal: number;
}

export interface GraphSourceLinkIdentity {
  node: GraphNodeSourceIdentity;
  label: string;
  path: readonly (string | number)[];
  scrubbable: boolean;
}

const GRAPH_IDENTITY_PATTERN = /^([^:]+):(\d+)$/;
const LEGACY_OFFSET_KEY_PATTERN = /^([^:]+):call:(\d+):(\d+)$/;

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

export function graphSourceLinkIdentityForLink(
  links: readonly GraphSourceLink[],
  link: GraphSourceLink,
): GraphSourceLinkIdentity | null {
  const node = graphNodeSourceIdentityForNode(links, link.nodeId);
  if (!node) return null;
  return {
    node,
    label: link.label,
    path: [...link.path],
    scrubbable: isScrubbableSourceLink(link),
  };
}

export function sourceLinkForGraphSourceLinkIdentity(
  links: readonly GraphSourceLink[],
  identity: GraphSourceLinkIdentity,
): GraphSourceLink | null {
  const nodeLink = sourceLinkForGraphNodeIdentity(links, identity.node);
  if (!nodeLink) return null;
  return links.find((link) => {
    return link.nodeId === nodeLink.nodeId
      && link.label === identity.label
      && link.end > link.start
      && isScrubbableSourceLink(link) === identity.scrubbable
      && sourcePathsEqual(link.path, identity.path);
  }) ?? null;
}

export function graphNodeIdentityKeyForNode(
  links: readonly GraphSourceLink[],
  nodeId: number,
): string | null {
  const identity = graphNodeSourceIdentityForNode(links, nodeId);
  return identity ? graphNodeIdentityKey(identity) : null;
}

export function sourceLinkForGraphNodeIdentityKey(
  links: readonly GraphSourceLink[],
  key: string,
): GraphSourceLink | null {
  const identity = graphNodeIdentityFromKey(key);
  if (identity) return sourceLinkForGraphNodeIdentity(links, identity);

  const legacy = legacySourceOffsetKey(key);
  if (!legacy) return null;
  return graphCallLinks(links).find((link) => {
    return link.nodeKind === legacy.nodeKind
      && link.start === legacy.start
      && link.end === legacy.end;
  }) ?? null;
}

function graphNodeIdentityKey(identity: GraphNodeSourceIdentity): string {
  return `${identity.nodeKind}:${identity.callOrdinal}`;
}

function graphNodeIdentityFromKey(key: string): GraphNodeSourceIdentity | null {
  const match = GRAPH_IDENTITY_PATTERN.exec(key);
  if (!match) return null;
  const callOrdinal = Number(match[2]);
  return Number.isInteger(callOrdinal) ? { nodeKind: match[1], callOrdinal } : null;
}

function legacySourceOffsetKey(key: string): { nodeKind: string; start: number; end: number } | null {
  const match = LEGACY_OFFSET_KEY_PATTERN.exec(key);
  if (!match) return null;
  const start = Number(match[2]);
  const end = Number(match[3]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  return { nodeKind: match[1], start, end };
}

function graphCallLinks(links: readonly GraphSourceLink[]): GraphSourceLink[] {
  return links
    .filter((link) => link.label === "call" && link.end > link.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function isScrubbableSourceLink(link: GraphSourceLink): boolean {
  return link.scrubbable !== false;
}
