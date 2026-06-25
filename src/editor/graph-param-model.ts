import { UP, X, Y, Z, rotateToMatrix } from "../core/math";
import { formatParamPath, type ParamPath } from "./graph-edit-model";
import { isCountParamLabel, isNonNegativeParamLabel } from "./scrub-values";

export interface NumericParam {
  label: string;
  path: ParamPath;
  value: number;
}

export interface NumericRange {
  min: number;
  max: number;
}

export type OrientationAxis = "x" | "y" | "z";

export const ORIENTATION_AXES: OrientationAxis[] = ["x", "y", "z"];

const MATRIX_CELL_PATHS: ParamPath[] = [0, 1, 2].flatMap((row) => {
  return [0, 1, 2].map((column) => ["matrix", row, column]);
});

export function matrixCellPaths(): ParamPath[] {
  return MATRIX_CELL_PATHS;
}

export function collectNumericParams(params: Record<string, unknown>): NumericParam[] {
  const out: NumericParam[] = [];
  walkParams(params, [], out);
  return out;
}

function walkParams(value: unknown, path: ParamPath, out: NumericParam[]): void {
  if (typeof value === "number") {
    out.push({ label: formatParamPath(path), path: [...path], value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkParams(item, [...path, index], out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "ease") continue;
      walkParams(item, [...path, key], out);
    }
  }
}

export function matrixParam(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const rows = value.map((row) => Array.isArray(row) ? row.map(Number) : []);
  if (!rows.every((row) => row.length === 3 && row.every(Number.isFinite))) return null;
  return rows;
}

export function axisForMatrix(matrix: number[][] | null): OrientationAxis | "custom" {
  if (!matrix) return "custom";
  for (const axis of ORIENTATION_AXES) {
    if (matricesClose(matrix, orientationMatrix(axis))) return axis;
  }
  return "custom";
}

export function orientationMatrix(axis: OrientationAxis): number[][] {
  const target = axis === "x" ? X : axis === "y" ? Y : Z;
  return rotateToMatrix(UP, target);
}

export function matricesClose(a: number[][], b: number[][]): boolean {
  return a.length === b.length && a.every((row, rowIndex) => {
    return row.length === b[rowIndex].length && row.every((value, columnIndex) => {
      return Math.abs(value - b[rowIndex][columnIndex]) < 1e-9;
    });
  });
}

export function cloneMatrix(matrix: number[][]): number[][] {
  return matrix.map((row) => [...row]);
}

export function formatParamNumber(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(4).replace(/\.?0+$/, "");
}

export function rangeBoundsFor(field: NumericParam, value: number): NumericRange {
  const label = field.label.toLowerCase();
  if (label.startsWith("matrix")) return { min: -1, max: 1 };

  if (isCountParamLabel(label)) {
    const radius = Math.min(24, Math.max(4, Math.abs(value) * 0.5));
    return {
      min: Math.max(1, Math.floor(value - radius)),
      max: Math.max(2, Math.ceil(value + radius)),
    };
  }

  const radius = Math.min(4, Math.max(0.25, Math.abs(value) * 1.5));
  const min = isNonNegativeParamLabel(label) ? Math.max(0, value - radius) : value - radius;
  return { min, max: value + radius };
}

export function stepFor(field: NumericParam): number {
  if (isCountParamLabel(field.label.toLowerCase())) return 1;
  const size = Math.abs(field.value);
  if (size >= 10) return 0.1;
  if (size >= 1) return 0.01;
  return 0.001;
}
