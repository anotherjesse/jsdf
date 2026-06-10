import type { GraphSourceLink } from "./clean-source-patch";

export interface StickySourceLinkOptions {
  stickyColumns?: number;
  preferredNodeId?: number | null;
}

export function sourceLinkAtOffset(
  links: readonly GraphSourceLink[],
  offset: number,
): GraphSourceLink | null {
  const containing = links.filter((candidate) => {
    return candidate.end > candidate.start && offset >= candidate.start && offset <= candidate.end;
  });
  return containing.sort(compareMostSpecificLink)[0] ?? null;
}

export function stickySourceLinkAtOffset(
  links: readonly GraphSourceLink[],
  offset: number,
  lineForOffset: (offset: number) => number,
  options: StickySourceLinkOptions = {},
): GraphSourceLink | null {
  const exact = sourceLinkAtOffset(links, offset);
  if (exact) return exact;

  const stickyColumns = options.stickyColumns ?? 2;
  if (stickyColumns <= 0) return null;
  const line = lineForOffset(offset);
  const preferredNodeId = options.preferredNodeId ?? null;

  const nearby = links
    .filter((candidate) => {
      return candidate.end > candidate.start
        && candidateDistance(candidate, offset) <= stickyColumns
        && lineForOffset(candidate.start) === line
        && lineForOffset(candidate.end) === line;
    })
    .sort((a, b) => {
      const preferred = Number(b.nodeId === preferredNodeId) - Number(a.nodeId === preferredNodeId);
      return preferred
        || candidateDistance(a, offset) - candidateDistance(b, offset)
        || compareMostSpecificLink(a, b);
    });

  return nearby[0] ?? null;
}

function compareMostSpecificLink(a: GraphSourceLink, b: GraphSourceLink): number {
  return (a.end - a.start) - (b.end - b.start) || b.start - a.start;
}

function candidateDistance(candidate: GraphSourceLink, offset: number): number {
  if (offset < candidate.start) return candidate.start - offset;
  if (offset > candidate.end) return offset - candidate.end;
  return 0;
}
