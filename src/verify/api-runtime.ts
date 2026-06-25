import * as api from "../index";
import { buildApiCompletenessFixtures, unsupportedOriginalApi } from "../api/completeness";
import { type SDF, type SDF2, type SDF3 } from "../core/nodes";
import { findGraphSourceLinks } from "../editor/clean-source-patch";
import { evaluateSource } from "../editor/evaluate-source";
import { exampleSources, sourceForExample } from "../editor/example-source";
import { evaluate2, evaluate3 } from "../evaluate";
import { examples } from "../examples";
import { compileGLSLScene } from "../glsl/compiler";
import { resolveAnnotation3 } from "../annotations/resolver";
import { compileScene } from "../wgsl/compiler";

export interface ApiRuntimeVerification {
  ok: boolean;
  supportedCount: number;
  unsupported: string[];
  fixtureCounts: {
    two: number;
    three: number;
  };
  nodeKinds: {
    covered: string[];
    missing: string[];
  };
  timings: {
    evaluateMs: number;
    glslCompileMs: number;
    wgslCompileMs: number;
    workflowMs: number;
  };
  workflow: {
    generatedTriangles: number;
    generatedDims: [number, number, number];
    saveBytes: number;
    save3mfBytes: number;
    methodSave3mfBytes: number;
    save3mfColors: number;
    save3mfWarnings: number;
    save3mfVertices: number;
    save3mfSharedEdges: number;
    methodSaveBytes: number;
    sliceDistinct: number;
    methodSampleWidth: number;
    methodSampleHeight: number;
    methodSliceDistinct: number;
    sliceAxes: string;
    methodSampleAxes: string;
  };
  examples: {
    total: number;
    sourceEvaluated: number;
    finiteSampled: number;
    glslCompiled: number;
    wgslCompiled: number;
    sourceLinks: number;
    checked: ExampleCheckSummary[];
  };
  errors: string[];
}

export interface ExampleCheckSummary {
  id: string;
  name: string;
  nodes: number;
  sourceLinks: number;
}

const expectedExports = [
  "circle", "line", "slab2", "rectangle", "rounded_rectangle", "equilateral_triangle", "hexagon", "rounded_x", "polygon", "vesica",
  "sphere", "plane", "slab", "box", "rounded_box", "wireframe_box", "torus", "capsule", "cylinder", "capped_cylinder",
  "rounded_cylinder", "capped_cone", "rounded_cone", "ellipsoid", "pyramid", "tetrahedron", "octahedron", "dodecahedron", "icosahedron",
  "name", "color",
  "union", "difference", "intersection", "blend", "negate", "dilate", "erode", "shell", "repeat",
  "transition_linear", "transition_radial", "extrude_to", "ease",
  "generate", "save", "save3mf", "sample_slice", "show_slice", "write_binary_stl",
];

const expected2Methods = [
  "union", "difference", "intersection", "blend", "negate", "dilate", "erode", "shell", "repeat",
  "name", "color",
  "translate", "scale", "rotate", "circular_array", "elongate", "extrude", "extrude_to", "revolve",
];

const expected3Methods = [
  "union", "difference", "intersection", "blend", "negate", "dilate", "erode", "shell", "repeat",
  "name", "color",
  "translate", "scale", "rotate", "rotate_to", "orient", "circular_array", "elongate", "twist", "bend",
  "bend_linear", "bend_radial", "transition_linear", "transition_radial", "wrap_around", "slice",
  "generate", "save", "sample_slice", "show_slice",
  "save3mf",
];

const expectedNodeKinds = [
  "circle", "line", "rectangle", "roundedRectangle", "equilateralTriangle", "hexagon", "roundedX", "polygon", "vesica",
  "sphere", "plane", "box", "roundedBox", "wireframeBox", "torus", "capsule", "cylinder", "cappedCylinder", "roundedCylinder",
  "cappedCone", "roundedCone", "ellipsoid", "pyramid", "tetrahedron", "octahedron", "dodecahedron", "icosahedron",
  "name", "color",
  "union", "difference", "intersection", "blend", "negate", "dilate", "erode", "shell", "repeat",
  "translate", "scale", "rotate2", "rotate3", "circularArray2", "circularArray3", "elongate2", "elongate3",
  "twist", "bend", "bendLinear", "bendRadial", "transitionLinear", "transitionRadial", "wrapAround",
  "slice", "extrude", "extrudeTo", "revolve",
];

const sample2 = [[0, 0], [0.25, -0.5], [1.1, 0.7], [-0.8, 1.3]];
const sample3 = [[0, 0, 0], [0.25, -0.5, 0.75], [1.1, 0.7, -0.4], [-0.8, 1.3, 0.2]];

export async function runApiRuntimeVerification(): Promise<ApiRuntimeVerification> {
  const errors: string[] = [];
  const fixtures = buildApiCompletenessFixtures();

  verifyExports(errors);
  verifyMethods(fixtures.two[0], expected2Methods, errors, "SDF2");
  verifyMethods(fixtures.three[0], expected3Methods, errors, "SDF3");

  const evalStart = performance.now();
  verifyFiniteEvaluation(fixtures.two, fixtures.three, errors);
  verifyAnnotationResolution(errors);
  const evaluateMs = performance.now() - evalStart;

  const glslStart = performance.now();
  verifyCompilation(fixtures.two.map((fixture) => fixture.extrude(0.5)), compileGLSLScene, errors, "GLSL");
  verifyCompilation(fixtures.three, compileGLSLScene, errors, "GLSL");
  const glslCompileMs = performance.now() - glslStart;

  const wgslStart = performance.now();
  verifyCompilation(fixtures.two.map((fixture) => fixture.extrude(0.5)), compileScene, errors, "WGSL");
  verifyCompilation(fixtures.three, compileScene, errors, "WGSL");
  const wgslCompileMs = performance.now() - wgslStart;

  const workflowStart = performance.now();
  const workflow = await verifyWorkflow(errors);
  const workflowMs = performance.now() - workflowStart;
  const exampleHealth = verifyExamples(errors);

  const covered = collectKinds([...fixtures.two, ...fixtures.three]);
  const missing = expectedNodeKinds.filter((kind) => !covered.has(kind));
  for (const kind of missing) errors.push(`missing fixture coverage for node kind: ${kind}`);

  return {
    ok: errors.length === 0,
    supportedCount: expectedExports.length + expected2Methods.length + expected3Methods.length,
    unsupported: [...unsupportedOriginalApi],
    fixtureCounts: { two: fixtures.two.length, three: fixtures.three.length },
    nodeKinds: { covered: [...covered].sort(), missing },
    timings: { evaluateMs, glslCompileMs, wgslCompileMs, workflowMs },
    workflow,
    examples: exampleHealth,
    errors,
  };
}

function verifyExports(errors: string[]): void {
  for (const name of expectedExports) {
    if (!(name in api)) errors.push(`missing API export: ${name}`);
  }
}

function verifyMethods(target: object, methods: string[], errors: string[], label: string): void {
  for (const method of methods) {
    if (!(method in target)) errors.push(`missing ${label} method: ${method}`);
  }
}

function verifyFiniteEvaluation(two: SDF2[], three: SDF3[], errors: string[]): void {
  for (const [index, fixture] of two.entries()) {
    for (const point of sample2) {
      const value = evaluate2(fixture, point);
      if (!Number.isFinite(value)) errors.push(`non-finite SDF2 fixture ${index} at ${point.join(",")}: ${value}`);
    }
  }

  for (const [index, fixture] of three.entries()) {
    for (const point of sample3) {
      const value = evaluate3(fixture, point);
      if (!Number.isFinite(value)) errors.push(`non-finite SDF3 fixture ${index} at ${point.join(",")}: ${value}`);
    }
  }
}

function verifyAnnotationResolution(errors: string[]): void {
  const named = api.sphere(1).name("shell");
  const recolored = resolveAnnotation3(named, [1, 0, 0], { colorsByName: { shell: "#facc15" } });
  if (recolored.colorHex !== "#facc15") errors.push(`colorsByName did not recolor annotation: ${recolored.colorHex}`);

  const base = api.box(2).name("base").color("#0f766e");
  const cutter = api.sphere(0.65).name("cutter").color("#ef4444");
  const cut = base.difference(cutter);
  const resolved = resolveAnnotation3(cut, [1, 0, 0]);
  if (resolved.name !== "base" || resolved.colorHex !== "#0f766e") {
    errors.push(`difference cutter annotation leaked into base: ${resolved.name ?? "none"} ${resolved.colorHex}`);
  }
}

function verifyCompilation(
  fixtures: SDF3[],
  compile: (fixture: SDF3) => { source: string; sceneFunction: string },
  errors: string[],
  label: string,
): void {
  for (const [index, fixture] of fixtures.entries()) {
    try {
      const compiled = compile(fixture);
      if (!compiled.source.includes("scene")) errors.push(`${label} fixture ${index} has no scene function`);
      if (compiled.source.includes("undefined") || compiled.source.includes("NaN")) {
        errors.push(`${label} fixture ${index} compiled invalid source`);
      }
    } catch (error) {
      errors.push(`${label} fixture ${index} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function collectKinds(fixtures: SDF[]): Set<string> {
  const kinds = new Set<string>();
  const seen = new Set<number>();

  function visit(sdf: SDF): void {
    if (seen.has(sdf.node.id)) return;
    seen.add(sdf.node.id);
    kinds.add(sdf.node.kind);
    for (const child of sdf.node.children) visit(child);
  }

  for (const fixture of fixtures) visit(fixture);
  return kinds;
}

function verifyExamples(errors: string[]): ApiRuntimeVerification["examples"] {
  const checked: ExampleCheckSummary[] = [];
  let sourceEvaluated = 0;
  let finiteSampled = 0;
  let glslCompiled = 0;
  let wgslCompiled = 0;
  let sourceLinks = 0;

  for (const example of examples) {
    try {
      if (!(example.id in exampleSources)) errors.push(`example ${example.id} has no editable source`);
      const built = example.build();
      const source = sourceForExample(example.id);
      const { sdf } = evaluateSource(source);
      sourceEvaluated += 1;

      const builtKinds = kindCounts(built);
      const sourceKinds = kindCounts(sdf);
      if (builtKinds !== sourceKinds) {
        errors.push(`example ${example.id} source graph differs from build graph: ${sourceKinds} !== ${builtKinds}`);
      }

      const links = findGraphSourceLinks(source, sdf);
      sourceLinks += links.length;
      if (!links.some((link) => link.label === "call")) errors.push(`example ${example.id} has no graph call source links`);
      if (!links.some((link) => link.scrubbable !== false && link.end > link.start)) {
        errors.push(`example ${example.id} has no scrubbable source links`);
      }

      verifyExampleFiniteSamples(example.id, sdf, example.bounds, errors);
      finiteSampled += 1;

      verifyExampleCompilation(example.id, sdf, compileGLSLScene, "GLSL", errors);
      glslCompiled += 1;
      verifyExampleCompilation(example.id, sdf, compileScene, "WGSL", errors);
      wgslCompiled += 1;

      checked.push({
        id: example.id,
        name: example.name,
        nodes: countNodes(sdf),
        sourceLinks: links.length,
      });
    } catch (error) {
      errors.push(`example ${example.id} failed health check: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    total: examples.length,
    sourceEvaluated,
    finiteSampled,
    glslCompiled,
    wgslCompiled,
    sourceLinks,
    checked,
  };
}

function verifyExampleFiniteSamples(
  id: string,
  sdf: SDF3,
  bounds: [number[], number[]] | undefined,
  errors: string[],
): void {
  const [min, max] = bounds ?? [[-2, -2, -2], [2, 2, 2]];
  const center = midpoint(min, max);
  const span = [
    (max[0] - min[0]) * 0.23,
    (max[1] - min[1]) * 0.23,
    (max[2] - min[2]) * 0.23,
  ];
  const points = [
    center,
    [center[0] + span[0], center[1], center[2]],
    [center[0] - span[0], center[1], center[2]],
    [center[0], center[1] + span[1], center[2]],
    [center[0], center[1], center[2] + span[2]],
  ];

  for (const point of points) {
    const value = evaluate3(sdf, point);
    if (!Number.isFinite(value)) {
      errors.push(`example ${id} produced non-finite value at ${point.join(",")}: ${value}`);
      return;
    }
  }
}

function verifyExampleCompilation(
  id: string,
  sdf: SDF3,
  compile: (fixture: SDF3) => { source: string; sceneFunction: string },
  label: string,
  errors: string[],
): void {
  try {
    const compiled = compile(sdf);
    if (!compiled.source.includes(compiled.sceneFunction)) {
      errors.push(`${label} example ${id} missing scene function ${compiled.sceneFunction}`);
    }
    if (compiled.source.includes("undefined") || compiled.source.includes("NaN")) {
      errors.push(`${label} example ${id} compiled invalid source`);
    }
  } catch (error) {
    errors.push(`${label} example ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function kindCounts(sdf: SDF): string {
  const counts = new Map<string, number>();
  const seen = new Set<number>();
  const visit = (node: SDF["node"]) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    for (const child of node.children) visit(child.node);
  };
  visit(sdf.node);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => `${kind}:${count}`).join(",");
}

function countNodes(sdf: SDF): number {
  const seen = new Set<number>();
  const visit = (node: SDF["node"]) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    for (const child of node.children) visit(child.node);
  };
  visit(sdf.node);
  return seen.size;
}

function midpoint(min: number[], max: number[]): number[] {
  return [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
}

async function verifyWorkflow(errors: string[]): Promise<ApiRuntimeVerification["workflow"]> {
  const bounds: [number[], number[]] = [[-1.25, -1.25, -1.25], [1.25, 1.25, 1.25]];
  const sdf = api.sphere(1);
  const slice = api.sample_slice(sdf, { z: 0, w: 48, h: 40, bounds });
  if (slice.width !== 48 || slice.height !== 40) errors.push(`slice dimensions mismatch: ${slice.width}x${slice.height}`);
  if (slice.axes !== "YX") errors.push(`slice axes mismatch: ${slice.axes}`);
  verifyFiniteSlice(slice.values, errors);

  const sliceCanvas = api.show_slice(sdf, { z: 0, w: 48, h: 40, bounds });
  const sliceDistinct = Number(sliceCanvas.dataset.sdfSliceDistinct ?? 0);
  if (sliceCanvas.width !== 48 || sliceCanvas.height !== 40) {
    errors.push(`show_slice canvas dimensions mismatch: ${sliceCanvas.width}x${sliceCanvas.height}`);
  }
  if (sliceDistinct < 2) errors.push(`show_slice rendered too few distinct colors: ${sliceDistinct}`);

  const methodCanvas = sdf.show_slice({ z: 0, w: 32, h: 32, bounds });
  const methodSliceDistinct = Number(methodCanvas.dataset.sdfSliceDistinct ?? 0);
  if (methodCanvas.width !== 32 || methodCanvas.height !== 32) {
    errors.push(`SDF3.show_slice canvas dimensions mismatch: ${methodCanvas.width}x${methodCanvas.height}`);
  }
  if (methodSliceDistinct < 2) errors.push(`SDF3.show_slice rendered too few distinct colors: ${methodSliceDistinct}`);

  const methodSample = sdf.sample_slice({ z: 0, w: 34, h: 30, bounds });
  if (methodSample.width !== 34 || methodSample.height !== 30) {
    errors.push(`SDF3.sample_slice dimensions mismatch: ${methodSample.width}x${methodSample.height}`);
  }
  if (methodSample.axes !== "YX") errors.push(`SDF3.sample_slice axes mismatch: ${methodSample.axes}`);
  verifyFiniteSlice(methodSample.values, errors);

  const mesh = await api.generate(sdf, {
    bounds,
    samples: 18 ** 3,
    preferGPU: false,
    preferWorker: false,
    algorithm: "surface-net",
  });
  if (mesh.triangles.length <= 0) errors.push("generate workflow produced no triangles");
  if (mesh.dims.some((dim) => dim < 2)) errors.push(`generate workflow produced invalid dims: ${mesh.dims.join(",")}`);

  const saveBlob = await api.save("api-check.stl", sdf, {
    bounds,
    grid: 18,
    preferGPU: false,
    preferWorker: false,
    download: false,
  });
  const methodSaveBlob = await sdf.save("api-method.stl", {
    bounds,
    grid: 14,
    preferGPU: false,
    preferWorker: false,
    download: false,
  });
  const writeBlob = api.write_binary_stl("api-write.stl", mesh, { download: false });
  const colored = api.union(
    api.sphere(0.75).translate([-0.45, 0, 0]).name("left").color("#ef4444"),
    api.sphere(0.75).translate([0.45, 0, 0]).name("right").color("#22c55e"),
  ) as SDF3;
  const save3mf = await api.save3mf("api-check.3mf", colored, {
    bounds,
    grid: 18,
    preferGPU: false,
    preferWorker: false,
    download: false,
  });
  const methodSave3mf = await colored.save3mf("api-method.3mf", {
    bounds,
    grid: 14,
    preferGPU: false,
    preferWorker: false,
    download: false,
  });
  if (saveBlob.size <= 84) errors.push(`save workflow Blob too small: ${saveBlob.size}`);
  if (methodSaveBlob.size <= 84) errors.push(`SDF3.save Blob too small: ${methodSaveBlob.size}`);
  if (writeBlob.size !== 84 + mesh.triangles.length * 50) {
    errors.push(`write_binary_stl size mismatch: ${writeBlob.size}`);
  }
  if (save3mf.blob.size <= 512) errors.push(`save3mf Blob too small: ${save3mf.blob.size}`);
  if (methodSave3mf.blob.size <= 512) errors.push(`SDF3.save3mf Blob too small: ${methodSave3mf.blob.size}`);
  if (save3mf.report.colors.length < 2) errors.push(`save3mf resolved too few colors: ${save3mf.report.colors.length}`);
  const threeMfEntries = await zipEntries(save3mf.blob);
  const model = threeMfEntries.get("3D/3dmodel.model") ?? "";
  if (!threeMfEntries.has("[Content_Types].xml") || !threeMfEntries.has("_rels/.rels") || !model.includes("<m:colorgroup id=\"1\">")) {
    errors.push("save3mf package is missing expected 3MF entries");
  }
  if (!model.includes("p1=\"0\"") || !model.includes("pid=\"1\"")) {
    errors.push("save3mf package is missing triangle color properties");
  }
  const topology = threeMfTopology(model);
  if (topology.vertices >= topology.triangles * 3) {
    errors.push(`save3mf did not share vertex indices: ${topology.vertices} vertices for ${topology.triangles} triangles`);
  }
  if (topology.sharedEdges <= 0) errors.push("save3mf did not produce any shared triangle edges");
  await expectRejects(() => api.save3mf("bad-unit.3mf", colored, {
    bounds,
    grid: 8,
    preferGPU: false,
    preferWorker: false,
    download: false,
    unit: "banana" as never,
  }), "invalid 3MF unit", errors);
  await expectRejects(() => api.save3mf("strict.3mf", colored, {
    bounds,
    grid: 8,
    preferGPU: false,
    preferWorker: false,
    download: false,
    colorsByName: { missing: "#ffffff" },
    strict: true,
  }), "strict mode", errors);

  return {
    generatedTriangles: mesh.triangles.length,
    generatedDims: mesh.dims,
    saveBytes: saveBlob.size,
    save3mfBytes: save3mf.blob.size,
    methodSave3mfBytes: methodSave3mf.blob.size,
    save3mfColors: save3mf.report.colors.length,
    save3mfWarnings: save3mf.report.warnings.length,
    save3mfVertices: topology.vertices,
    save3mfSharedEdges: topology.sharedEdges,
    methodSaveBytes: methodSaveBlob.size,
    sliceDistinct,
    methodSampleWidth: methodSample.width,
    methodSampleHeight: methodSample.height,
    methodSliceDistinct,
    sliceAxes: slice.axes,
    methodSampleAxes: methodSample.axes,
  };
}

async function expectRejects(action: () => Promise<unknown>, message: string, errors: string[]): Promise<void> {
  try {
    await action();
    errors.push(`expected rejection containing "${message}"`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!text.includes(message)) errors.push(`expected rejection containing "${message}", got "${text}"`);
  }
}

async function zipEntries(blob: Blob): Promise<Map<string, string>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const signature = view.getUint32(0, true);
    if (signature !== 0x04034b50) break;
    const compression = view.getUint16(8, true);
    const compressedSize = view.getUint32(18, true);
    const uncompressedSize = view.getUint32(22, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    if (compression !== 0) throw new Error(`unexpected ZIP compression method ${compression}`);
    if (compressedSize !== uncompressedSize) throw new Error(`unexpected ZIP size mismatch ${compressedSize} !== ${uncompressedSize}`);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = decoder.decode(bytes.slice(nameStart, nameEnd));
    entries.set(name, decoder.decode(bytes.slice(dataStart, dataEnd)));
    offset = dataEnd;
  }
  if (!entries.has("3D/3dmodel.model")) throw new Error("ZIP package did not contain 3D/3dmodel.model");
  return entries;
}

function threeMfTopology(model: string): { vertices: number; triangles: number; sharedEdges: number } {
  const vertices = [...model.matchAll(/<vertex\b/g)].length;
  const edgeCounts = new Map<string, number>();
  let triangles = 0;
  for (const match of model.matchAll(/<triangle\b[^>]*\bv1="(\d+)"[^>]*\bv2="(\d+)"[^>]*\bv3="(\d+)"/g)) {
    triangles += 1;
    const indices = [Number(match[1]), Number(match[2]), Number(match[3])];
    for (const [a, b] of [[indices[0], indices[1]], [indices[1], indices[2]], [indices[2], indices[0]]]) {
      const key = a < b ? `${a}/${b}` : `${b}/${a}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  let sharedEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count > 1) sharedEdges += 1;
  }
  return { vertices, triangles, sharedEdges };
}

function verifyFiniteSlice(values: Float32Array, errors: string[]): void {
  let negative = 0;
  let positive = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      errors.push(`sample_slice produced non-finite value: ${value}`);
      return;
    }
    if (value < 0) negative += 1;
    if (value > 0) positive += 1;
  }
  if (negative === 0 || positive === 0) {
    errors.push(`sample_slice should cross the surface, saw ${negative} negative and ${positive} positive samples`);
  }
}
