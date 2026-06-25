import { createAnnotationResolver3, collectAnnotationNames, DEFAULT_ANNOTATION_COLOR, type AnnotationResolveOptions } from "../annotations/resolver";
import { colorToHex } from "../core/color";
import type { SDF3 } from "../core/nodes";
import type { MeshResult } from "./generate";
import type { Triangle } from "./polygonize";
import { downloadBlob } from "./stl";

export type ThreeMfCompatibility = "generic" | "prusa" | "bambu" | "orca";
export type ThreeMfUnit = "micron" | "millimeter" | "centimeter" | "inch" | "foot" | "meter";

const THREE_MF_UNITS = new Set<string>(["micron", "millimeter", "centimeter", "inch", "foot", "meter"]);
const THREE_MF_COMPATIBILITY = new Set<string>(["generic", "prusa", "bambu", "orca"]);

export interface ThreeMfExportOptions extends AnnotationResolveOptions {
  name?: string;
  download?: boolean;
  compatibility?: ThreeMfCompatibility;
  unit?: ThreeMfUnit;
  strict?: boolean;
}

export interface ThreeMfExportReport {
  triangles: number;
  colors: Array<{ color: string; triangles: number; labels: string[] }>;
  warnings: string[];
  ambiguousTriangles: number;
  compatibility: ThreeMfCompatibility;
}

export interface ThreeMfExportResult {
  blob: Blob;
  report: ThreeMfExportReport;
}

interface TriangleAssignment {
  color: string;
  colorIndex: number;
  label: string;
  ambiguous: boolean;
}

export function write_3mf(
  filename: string,
  mesh: MeshResult | Triangle[],
  sdf: SDF3,
  options: ThreeMfExportOptions = {},
): ThreeMfExportResult {
  const triangles = Array.isArray(mesh) ? mesh : mesh.triangles;
  const unit = threeMfUnit(options.unit ?? "millimeter");
  const assignments = assignTriangleColors(triangles, sdf, options);
  const colors = uniqueColors(assignments);
  const modelName = options.name ?? (filename.replace(/\.3mf$/i, "") || "sdf-browser");
  const report = exportReport(triangles, assignments, colors, sdf, options);
  const model = modelXml(triangles, assignments, colors, {
    name: modelName,
    unit,
  });
  const blob = zip([
    {
      path: "[Content_Types].xml",
      data: xmlBytes(contentTypesXml()),
    },
    {
      path: "_rels/.rels",
      data: xmlBytes(rootRelationshipsXml()),
    },
    {
      path: "3D/3dmodel.model",
      data: xmlBytes(model),
    },
  ], "model/3mf");
  if (options.download !== false) downloadBlob(blob, filename);
  return { blob, report };
}

function assignTriangleColors(triangles: Triangle[], sdf: SDF3, options: ThreeMfExportOptions): TriangleAssignment[] {
  const resolver = createAnnotationResolver3(sdf, {
    colorsByName: options.colorsByName,
    defaultColor: options.defaultColor ?? DEFAULT_ANNOTATION_COLOR,
    ambiguityEpsilon: options.ambiguityEpsilon,
  });
  const colorIndices = new Map<string, number>();
  return triangles.map((triangle) => {
    const resolved = resolver(centroid(triangle));
    const color = resolved.colorHex.toLowerCase();
    let colorIndex = colorIndices.get(color);
    if (colorIndex == null) {
      colorIndex = colorIndices.size;
      colorIndices.set(color, colorIndex);
    }
    return {
      color,
      colorIndex,
      label: resolved.name ?? generatedLabel(color),
      ambiguous: resolved.ambiguous,
    };
  });
}

function uniqueColors(assignments: TriangleAssignment[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const assignment of assignments) {
    if (seen.has(assignment.color)) continue;
    seen.add(assignment.color);
    out.push(assignment.color);
  }
  if (out.length === 0) out.push(colorToHex(DEFAULT_ANNOTATION_COLOR));
  return out;
}

function exportReport(
  triangles: Triangle[],
  assignments: TriangleAssignment[],
  colors: string[],
  sdf: SDF3,
  options: ThreeMfExportOptions,
): ThreeMfExportReport {
  const warnings: string[] = [];
  const compatibility = threeMfCompatibility(options.compatibility ?? "generic");
  const byColor = new Map<string, { color: string; triangles: number; labels: Set<string> }>();
  for (const assignment of assignments) {
    const entry = byColor.get(assignment.color) ?? { color: assignment.color, triangles: 0, labels: new Set<string>() };
    entry.triangles += 1;
    entry.labels.add(assignment.label);
    byColor.set(assignment.color, entry);
  }

  const annotationNames = collectAnnotationNames(sdf.node);
  for (const [label, count] of annotationNames) {
    if (count > 1 && options.colorsByName?.[label] != null) {
      warnings.push(`label "${label}" appears ${count} times; colorsByName recolored every matching region`);
    }
  }
  for (const label of Object.keys(options.colorsByName ?? {})) {
    if (!annotationNames.has(label)) {
      const message = `colorsByName contains "${label}", but no matching .name("${label}") annotation was found`;
      warnings.push(message);
    }
  }

  const ambiguousTriangles = assignments.filter((assignment) => assignment.ambiguous).length;
  if (ambiguousTriangles > 0) warnings.push(`${ambiguousTriangles} triangles are near ambiguous annotation boundaries`);
  for (const entry of byColor.values()) {
    if (entry.triangles > 0 && entry.triangles < 8 && triangles.length >= 64) {
      warnings.push(`color ${entry.color} has a tiny island of ${entry.triangles} triangles`);
    }
  }
  if (colors.length <= 1) warnings.push("3MF contains a single resolved color");
  if (options.strict && warnings.length > 0) {
    throw new Error(`3MF export strict mode failed: ${warnings.join("; ")}`);
  }

  return {
    triangles: triangles.length,
    colors: [...byColor.values()].map((entry) => ({
      color: entry.color,
      triangles: entry.triangles,
      labels: [...entry.labels].sort(),
    })),
    warnings,
    ambiguousTriangles,
    compatibility,
  };
}

function modelXml(
  triangles: Triangle[],
  assignments: TriangleAssignment[],
  colors: string[],
  options: { name: string; unit: ThreeMfUnit },
): string {
  const indexed = indexedMesh(triangles);
  const vertices = indexed.vertices.map((point) => {
    return `        <vertex x="${n(point[0])}" y="${n(point[1])}" z="${n(point[2])}"/>`;
  });
  const triangleXml: string[] = [];
  triangles.forEach((triangle, index) => {
    const [v1, v2, v3] = indexed.triangles[index];
    const assignment = assignments[index] ?? { colorIndex: 0 };
    triangleXml.push(`        <triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="1" p1="${assignment.colorIndex}"/>`);
  });

  const colorXml = colors.map((color) => `      <m:color color="${escapeAttr(color.toUpperCase())}"/>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${options.unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m">
  <metadata name="Title">${escapeText(options.name)}</metadata>
  <resources>
    <m:colorgroup id="1">
${colorXml}
    </m:colorgroup>
    <object id="2" type="model" name="${escapeAttr(options.name)}" pid="1" pindex="0">
      <mesh>
        <vertices>
${vertices.join("\n")}
        </vertices>
        <triangles>
${triangleXml.join("\n")}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2"/>
  </build>
</model>
`;
}

function indexedMesh(triangles: Triangle[]): { vertices: number[][]; triangles: Array<[number, number, number]> } {
  const vertices: number[][] = [];
  const indices = new Map<string, number>();
  const indexedTriangles: Array<[number, number, number]> = [];
  triangles.forEach((triangle, triangleIndex) => {
    const usedInTriangle = new Set<number>();
    const triIndices = triangle.map((point, pointIndex) => {
      let key = vertexKey(point);
      let index = indices.get(key);
      if (index == null) {
        index = vertices.length;
        indices.set(key, index);
        vertices.push(point);
      }
      if (usedInTriangle.has(index)) {
        key = `${key}:triangle-${triangleIndex}-${pointIndex}`;
        index = vertices.length;
        indices.set(key, index);
        vertices.push(point);
      }
      usedInTriangle.add(index);
      return index;
    }) as [number, number, number];
    indexedTriangles.push(triIndices);
  });
  return { vertices, triangles: indexedTriangles };
}

function vertexKey(point: number[]): string {
  return `${n(point[0])},${n(point[1])},${n(point[2])}`;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;
}

function rootRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;
}

function centroid(triangle: Triangle): [number, number, number] {
  return [
    (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3,
    (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3,
    (triangle[0][2] + triangle[1][2] + triangle[2][2]) / 3,
  ];
}

function generatedLabel(color: string): string {
  return `color-${color.replace(/^#/, "")}`;
}

function n(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`invalid 3MF coordinate: ${value}`);
  return Math.abs(value) < 1e-12 ? "0" : value.toFixed(8).replace(/\.?0+$/, "");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function threeMfUnit(value: unknown): ThreeMfUnit {
  if (typeof value === "string" && THREE_MF_UNITS.has(value)) return value as ThreeMfUnit;
  throw new Error(`invalid 3MF unit: ${String(value)}`);
}

function threeMfCompatibility(value: unknown): ThreeMfCompatibility {
  if (typeof value === "string" && THREE_MF_COMPATIBILITY.has(value)) return value as ThreeMfCompatibility;
  throw new Error(`invalid 3MF compatibility: ${String(value)}`);
}

function xmlBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

interface ZipEntry {
  path: string;
  data: Uint8Array;
}

function zip(entries: ZipEntry[], type: string): Blob {
  const files: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = xmlBytes(entry.path);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    files.push(local, entry.data);

    const dir = new Uint8Array(46 + name.length);
    const dirView = new DataView(dir.buffer);
    dirView.setUint32(0, 0x02014b50, true);
    dirView.setUint16(4, 20, true);
    dirView.setUint16(6, 20, true);
    dirView.setUint16(8, 0, true);
    dirView.setUint16(10, 0, true);
    dirView.setUint16(12, 0, true);
    dirView.setUint16(14, 0, true);
    dirView.setUint32(16, crc, true);
    dirView.setUint32(20, entry.data.length, true);
    dirView.setUint32(24, entry.data.length, true);
    dirView.setUint16(28, name.length, true);
    dirView.setUint16(30, 0, true);
    dirView.setUint16(32, 0, true);
    dirView.setUint16(34, 0, true);
    dirView.setUint16(36, 0, true);
    dirView.setUint32(38, 0, true);
    dirView.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);
    offset += local.length + entry.data.length;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);
  return new Blob([...files, ...central, end].map(blobPart), { type });
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();
