import type { Node } from "../core/nodes";

export type ParamPath = Array<string | number>;
export type ParamValue = unknown;

export interface GraphParamEdit {
  node: Node;
  nodeId: number;
  nodeKind: string;
  path: ParamPath;
  label: string;
  previousValue: ParamValue;
  nextValue: ParamValue;
  editSessionId?: string;
}

export interface GraphDirtyParam {
  nodeId: number;
  path: ParamPath;
}

export function setParamAtPath(root: Record<string, unknown>, path: ParamPath, value: ParamValue): void {
  let target: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const part = path[i];
    target = Array.isArray(target)
      ? target[part as number] as Record<string, unknown> | unknown[]
      : target[part as string] as Record<string, unknown> | unknown[];
  }
  const key = path[path.length - 1];
  if (Array.isArray(target)) {
    target[key as number] = value;
  } else {
    target[key as string] = value;
  }
}

export function getParamAtPath(root: Record<string, unknown>, path: ParamPath): ParamValue {
  let target: unknown = root;
  for (const part of path) {
    target = Array.isArray(target)
      ? target[part as number]
      : (target as Record<string, unknown>)[part as string];
  }
  return target;
}

export function paramPathsEqual(a: ParamPath, b: ParamPath): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

export function graphParamKey(nodeId: number, path: ParamPath): string {
  return `${nodeId}:${path.map(String).join("/")}`;
}

export function paramPathStartsWith(path: ParamPath, prefix: ParamPath): boolean {
  return prefix.length > 0 && prefix.length < path.length && prefix.every((part, index) => part === path[index]);
}

export function formatParamPath(path: ParamPath): string {
  return path.map((part, index) => {
    if (typeof part === "number") return `[${part}]`;
    return index === 0 ? part : `.${part}`;
  }).join("");
}
