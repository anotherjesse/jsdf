import type { Node } from "../core/nodes";

export function f(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`invalid WGSL number: ${value}`);
  const cleaned = Math.abs(value) < 1e-12 ? 0 : value;
  const text = cleaned.toFixed(8).replace(/\.?0+$/, "");
  return text.includes(".") ? text : `${text}.0`;
}

export function v2(value: readonly number[]): string {
  return `vec2f(${f(value[0])}, ${f(value[1])})`;
}

export function v3(value: readonly number[]): string {
  return `vec3f(${f(value[0])}, ${f(value[1])}, ${f(value[2])})`;
}

export function fnName(node: Node): string {
  return `sdf_${node.id}`;
}

export function p<T>(node: Node): T {
  return node.params as T;
}

export function mat2Mul(matrix: number[][], variable: string): string {
  return `vec2f(dot(${variable}, vec2f(${f(matrix[0][0])}, ${f(matrix[1][0])})), dot(${variable}, vec2f(${f(matrix[0][1])}, ${f(matrix[1][1])})))`;
}

export function mat3Mul(matrix: number[][], variable: string): string {
  return `vec3f(dot(${variable}, vec3f(${f(matrix[0][0])}, ${f(matrix[1][0])}, ${f(matrix[2][0])})), dot(${variable}, vec3f(${f(matrix[0][1])}, ${f(matrix[1][1])}, ${f(matrix[2][1])})), dot(${variable}, vec3f(${f(matrix[0][2])}, ${f(matrix[1][2])}, ${f(matrix[2][2])})))`;
}
