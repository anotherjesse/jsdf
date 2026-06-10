import type { Node } from "../core/nodes";
import { fnName } from "../glsl/format";

export function selectedSceneFunction(root: Node): string {
  const lines = [
    "float selectedScene(vec3 p) {",
    "  if (u_highlightNode < 0) { return 1000000000.0; }",
  ];

  for (const node of collectNodes(root)) {
    const call = node.dim === 2 ? `${fnName(node)}(p.xy)` : `${fnName(node)}(p)`;
    lines.push(`  if (u_highlightNode == ${node.id}) { return ${call}; }`);
  }

  lines.push("  return 1000000000.0;");
  lines.push("}");
  return lines.join("\n");
}

function collectNodes(root: Node): Node[] {
  const out: Node[] = [];
  const seen = new Set<number>();

  const visit = (node: Node) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    out.push(node);
    for (const child of node.children) visit(child.node);
  };

  visit(root);
  return out;
}
