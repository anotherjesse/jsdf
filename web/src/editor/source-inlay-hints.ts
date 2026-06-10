import type { GraphSourceLink } from "./clean-source-patch";

export interface SourceInlayHint {
  label: string;
  offset: number;
  tooltip: string;
  kind: "node" | "param";
}

export function sourceInlayHintsForOffsetRange(
  links: readonly GraphSourceLink[],
  startOffset: number,
  endOffset: number,
): SourceInlayHint[] {
  const seen = new Set<string>();
  const hints: SourceInlayHint[] = [];
  for (const link of links) {
    if (link.end <= link.start || link.end < startOffset || link.start > endOffset) continue;
    const hint = sourceInlayHintForLink(link);
    if (!hint) continue;
    const key = `${hint.offset}:${hint.label}:${hint.tooltip}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push(hint);
  }
  return hints.sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label));
}

function sourceInlayHintForLink(link: GraphSourceLink): SourceInlayHint | null {
  if (link.label === "call") {
    return {
      label: `#${link.nodeId}`,
      offset: link.end,
      tooltip: `${link.nodeKind} #${link.nodeId}`,
      kind: "node",
    };
  }

  return {
    label: readableParamLabel(link.label),
    offset: link.end,
    tooltip: `${link.nodeKind} #${link.nodeId} ${link.label}`,
    kind: "param",
  };
}

function readableParamLabel(label: string): string {
  return label.replace(/\b(offset|size|center|normal|point|factor|spacing|count|padding|radius|a|b|p0|p1)\[(\d+)\]/g, (_, name: string, index: string) => {
    const axis = ["x", "y", "z", "w"][Number(index)];
    return axis ? `${name}.${axis}` : `${name}[${index}]`;
  });
}
