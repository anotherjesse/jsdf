import type { GraphSourceLink } from "./clean-source-patch";

export function adjacentSourceLink(
  links: readonly GraphSourceLink[],
  current: GraphSourceLink | null,
  direction: -1 | 1,
): GraphSourceLink | null {
  const ordered = navigableSourceLinks(links);
  if (ordered.length === 0) return null;
  if (!current) return direction > 0 ? ordered[0] : ordered[ordered.length - 1];

  const currentIndex = ordered.findIndex((link) => sourceLinkNavigationKey(link) === sourceLinkNavigationKey(current));
  if (currentIndex >= 0) {
    return ordered[(currentIndex + direction + ordered.length) % ordered.length];
  }

  const insertionIndex = ordered.findIndex((link) => link.start > current.start);
  if (direction > 0) return insertionIndex >= 0 ? ordered[insertionIndex] : ordered[0];
  const previousIndex = insertionIndex < 0 ? ordered.length - 1 : insertionIndex - 1;
  return ordered[(previousIndex + ordered.length) % ordered.length];
}

export function navigableSourceLinks(links: readonly GraphSourceLink[]): GraphSourceLink[] {
  return [...links]
    .filter((link) => link.end > link.start)
    .sort((left, right) => {
      return left.start - right.start
        || left.end - right.end
        || left.nodeId - right.nodeId
        || left.label.localeCompare(right.label);
    });
}

export function sourceLinkNavigationKey(link: GraphSourceLink): string {
  return [
    link.nodeId,
    link.nodeKind,
    link.label,
    link.path.map(String).join("/"),
    link.start,
    link.end,
  ].join(":");
}
