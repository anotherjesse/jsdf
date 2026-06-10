import type { Node } from "../core/nodes";

export type HighlightMode = "mark" | "focus";

export const HIGHLIGHT_PALETTE = "cyan";
export const HIGHLIGHT_GLSL_COLOR = "vec3(0.10, 0.88, 0.84)";

export function highlightStyle(node: Node | null, mode: HighlightMode): string {
  return node ? highlightStyleFromState(node.id, mode) : "";
}

export function highlightStyleFromState(nodeId: number, mode: HighlightMode): string {
  if (nodeId < 0) return "";
  return mode === "focus" ? "focus-fade" : "outline";
}
