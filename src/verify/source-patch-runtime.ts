import type { Node, SDF3 } from "../core/nodes";
import { findGraphSourceLinks, patchGraphEditSource } from "../editor/clean-source-patch";
import { evaluateSource } from "../editor/evaluate-source";
import type { GraphParamEdit } from "../editor/graph-edit-model";

export function verifySourcePatch(
  source: string,
  edit: GraphParamEdit | null,
  sdf: SDF3,
  errors: string[],
): string {
  if (!edit) {
    errors.push("source patch verification had no graph edit");
    return "";
  }
  const nextSource = patchGraphEditSource(source, sdf, edit, edit.nextValue);
  if (!nextSource) {
    errors.push("source patch verification did not patch source");
    return "";
  }
  if (!nextSource.includes("sphere(1.2)")) {
    errors.push("source patch verification did not update sphere literal");
  }
  const patchedLinks = findGraphSourceLinks(nextSource, sdf);
  const radiusLink = patchedLinks.find((link) => {
    return link.nodeId === edit.nodeId && link.label === "radius" && link.end > link.start;
  });
  if (!radiusLink) {
    errors.push("source patch verification did not rediscover edited radius link");
  } else if (nextSource.slice(radiusLink.start, radiusLink.end) !== "1.2") {
    errors.push("source patch verification radius link points at wrong text");
  }
  return nextSource.trim();
}

export function verifyVectorSourcePatches(errors: string[]): string[] {
  const patches = [
    verifyConstScalarPatch(errors),
    verifyConstVectorElementPatch(errors),
    verifyConstVectorArgumentPatch(errors),
    verifyMulAxisScalarPatch(errors),
    verifyMulOffAxisMaterialization(errors),
    verifyDirectAxisExpansion(errors),
  ].filter((source): source is string => Boolean(source));
  return patches;
}

function verifyConstScalarPatch(errors: string[]): string | null {
  const source = "const radius = 0.75\nreturn sphere(radius)";
  const { sdf } = evaluateSource(source);
  const sphere = findNodeByKind(sdf.node, "sphere");
  if (!sphere) {
    errors.push("const scalar fixture did not produce sphere");
    return null;
  }
  const links = findGraphSourceLinks(source, sdf);
  const radiusLink = links.find((link) => link.nodeId === sphere.id && link.label === "radius");
  if (!radiusLink || source.slice(radiusLink.start, radiusLink.end) !== "0.75") {
    errors.push("const scalar link did not point at const value");
  }

  const patched = patchGraphEditSource(source, sdf, graphEdit(sphere, ["radius"], "radius", 0.75, 1.1), 1.1);
  if (!patched) {
    errors.push("const scalar patch did not patch source");
    return null;
  }
  if (!patched.includes("const radius = 1.1")) {
    errors.push("const scalar patch did not preserve const reference style");
  }
  return patched;
}

function verifyConstVectorElementPatch(errors: string[]): string | null {
  const source = "const dx = -0.45\nreturn sphere(1).translate([dx, 0, 0])";
  const { sdf } = evaluateSource(source);
  const translate = findNodeByKind(sdf.node, "translate");
  if (!translate) {
    errors.push("const vector fixture did not produce translate");
    return null;
  }
  const links = findGraphSourceLinks(source, sdf);
  const offsetLink = links.find((link) => link.nodeId === translate.id && link.label === "offset[0]");
  if (!offsetLink || source.slice(offsetLink.start, offsetLink.end) !== "-0.45") {
    errors.push("const vector link did not point at const value");
  }

  const patched = patchGraphEditSource(source, sdf, graphEdit(translate, ["offset", 0], "offset[0]", -0.45, -0.25), -0.25);
  if (!patched) {
    errors.push("const vector patch did not patch source");
    return null;
  }
  if (!patched.includes("const dx = -0.25")) {
    errors.push("const vector patch did not preserve const reference style");
  }
  return patched;
}

function verifyConstVectorArgumentPatch(errors: string[]): string | null {
  const source = "const offset = [-0.45, 0, 0]\nreturn sphere(1).translate(offset)";
  const { sdf } = evaluateSource(source);
  const translate = findNodeByKind(sdf.node, "translate");
  if (!translate) {
    errors.push("const vector argument fixture did not produce translate");
    return null;
  }
  const links = findGraphSourceLinks(source, sdf);
  const offsetLink = links.find((link) => link.nodeId === translate.id && link.label === "offset[0]");
  if (!offsetLink || source.slice(offsetLink.start, offsetLink.end) !== "-0.45") {
    errors.push("const vector argument link did not point at const array value");
  }

  const patched = patchGraphEditSource(source, sdf, graphEdit(translate, ["offset", 0], "offset[0]", -0.45, -0.2), -0.2);
  if (!patched) {
    errors.push("const vector argument patch did not patch source");
    return null;
  }
  if (!patched.includes("const offset = [-0.2, 0, 0]")) {
    errors.push("const vector argument patch did not preserve vector const style");
  }
  const patchedLinks = findGraphSourceLinks(patched, sdf);
  const patchedOffset = patchedLinks.find((link) => link.nodeId === translate.id && link.label === "offset[0]");
  if (!patchedOffset || patched.slice(patchedOffset.start, patchedOffset.end) !== "-0.2") {
    errors.push("const vector argument patch did not rediscover const array value");
  }
  return patched;
}

function verifyMulAxisScalarPatch(errors: string[]): string | null {
  const source = "return sphere(1).translate(mul(Z, -3))";
  const { sdf } = evaluateSource(source);
  const translate = findNodeByKind(sdf.node, "translate");
  const offset = vectorParam(translate, "offset");
  if (!translate || !offset) {
    errors.push("mul axis scalar fixture did not produce translate offset");
    return null;
  }
  offset[2] = -2.5;
  const patched = patchGraphEditSource(source, sdf, graphEdit(translate, ["offset", 2], "offset[2]", -3, -2.5), -2.5);
  if (!patched) {
    errors.push("mul axis scalar patch did not patch source");
    return null;
  }
  if (!patched.includes("mul(Z, -2.5)")) {
    errors.push("mul axis scalar patch did not preserve mul(Z, value)");
  }
  return patched;
}

function verifyMulOffAxisMaterialization(errors: string[]): string | null {
  const source = "return sphere(1).translate(mul(Z, -3))";
  const { sdf } = evaluateSource(source);
  const translate = findNodeByKind(sdf.node, "translate");
  const offset = vectorParam(translate, "offset");
  if (!translate || !offset) {
    errors.push("mul off-axis fixture did not produce translate offset");
    return null;
  }
  offset[0] = 1.25;
  const patched = patchGraphEditSource(source, sdf, graphEdit(translate, ["offset", 0], "offset[0]", 0, 1.25), 1.25);
  if (!patched) {
    errors.push("mul off-axis patch did not patch source");
    return null;
  }
  if (!patched.includes("translate([1.25, 0, -3])")) {
    errors.push("mul off-axis patch did not materialize full vector");
  }
  const links = findGraphSourceLinks(patched, sdf);
  const link = links.find((candidate) => candidate.nodeId === translate.id && candidate.label === "offset[0]");
  if (!link || patched.slice(link.start, link.end) !== "1.25") {
    errors.push("mul off-axis patch did not rediscover materialized offset[0]");
  }
  return patched;
}

function verifyDirectAxisExpansion(errors: string[]): string | null {
  const source = "return sphere(1).translate(X)";
  const { sdf } = evaluateSource(source);
  const translate = findNodeByKind(sdf.node, "translate");
  const offset = vectorParam(translate, "offset");
  if (!translate || !offset) {
    errors.push("direct axis fixture did not produce translate offset");
    return null;
  }
  offset[0] = 2;
  const patched = patchGraphEditSource(source, sdf, graphEdit(translate, ["offset", 0], "offset[0]", 1, 2), 2);
  if (!patched) {
    errors.push("direct axis patch did not patch source");
    return null;
  }
  if (!patched.includes("translate(mul(X, 2))")) {
    errors.push("direct axis patch did not expand to mul(X, value)");
  }
  return patched;
}

function vectorParam(node: Node | null, key: string): number[] | null {
  const value = node?.params[key];
  return Array.isArray(value) && value.every((item) => typeof item === "number") ? value : null;
}

function graphEdit(
  node: Node,
  path: Array<string | number>,
  label: string,
  previousValue: number,
  nextValue: number,
): GraphParamEdit {
  return {
    node,
    nodeId: node.id,
    nodeKind: node.kind,
    path,
    label,
    previousValue,
    nextValue,
  };
}

function findNodeByKind(root: Node, kind: string, visited = new Set<number>()): Node | null {
  if (root.kind === kind) return root;
  if (visited.has(root.id)) return null;
  visited.add(root.id);
  for (const child of root.children) {
    const found = findNodeByKind(child.node, kind, visited);
    if (found) return found;
  }
  return null;
}
