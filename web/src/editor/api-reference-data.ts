export type ApiSymbolKind = "function" | "method" | "constant" | "class" | "namespace";
export type ApiCompletionScope = "global" | "method" | "ease";

export interface ApiReferenceSeed {
  kind: ApiSymbolKind;
  signature: string;
  description: string;
  group: string;
  completionScopes?: readonly ApiCompletionScope[];
}

const fn = (
  group: string,
  signature: string,
  description: string,
  kind: ApiSymbolKind = "function",
  completionScopes?: readonly ApiCompletionScope[],
): ApiReferenceSeed => ({ kind, group, signature, description, completionScopes });

const GLOBAL_AND_METHOD = ["global", "method"] as const satisfies readonly ApiCompletionScope[];

export const API_REFERENCE_SEEDS: Record<string, ApiReferenceSeed> = {
  SDF2: fn("Classes", "class SDF2", "2D SDF value returned by 2D primitives and operations.", "class"),
  SDF3: fn("Classes", "class SDF3", "3D SDF value returned by 3D primitives, extrusions, and revolves.", "class"),
  ease: fn("Easing", "ease.<name>", "Named easing functions for bends, transitions, extrusions, and wraps.", "namespace"),

  sphere: fn("3D Primitives", "sphere(radius = 1, center = ORIGIN): SDF3", "Creates a sphere with an optional center offset."),
  plane: fn("3D Primitives", "plane(normal = UP, point = ORIGIN): SDF3", "Creates an infinite half-space plane."),
  slab: fn("3D Primitives", "slab({ x0, x1, y0, y1, z0, z1, k }): SDF3", "Builds a bounded region from one or more axis-aligned planes."),
  box: fn("3D Primitives", "box(size = 1, center = ORIGIN): SDF3", "Creates an axis-aligned box from a scalar, vector size, or two corners."),
  rounded_box: fn("3D Primitives", "rounded_box(size, radius): SDF3", "Creates a box with rounded edges."),
  wireframe_box: fn("3D Primitives", "wireframe_box(size, thickness): SDF3", "Creates a frame around the edges of a box."),
  torus: fn("3D Primitives", "torus(majorRadius, tubeRadius): SDF3", "Creates a torus centered around the Z axis."),
  capsule: fn("3D Primitives", "capsule(a, b, radius): SDF3", "Creates a capsule along the segment from point a to point b."),
  cylinder: fn("3D Primitives", "cylinder(radius): SDF3", "Creates an infinite cylinder along the Z axis."),
  capped_cylinder: fn("3D Primitives", "capped_cylinder(a, b, radius): SDF3", "Creates a finite cylinder between two points."),
  rounded_cylinder: fn("3D Primitives", "rounded_cylinder(ra, rb, h): SDF3", "Creates a rounded finite cylinder."),
  capped_cone: fn("3D Primitives", "capped_cone(a, b, ra, rb): SDF3", "Creates a finite cone or tapered cylinder between two points."),
  rounded_cone: fn("3D Primitives", "rounded_cone(r1, r2, h): SDF3", "Creates a rounded cone centered on the Z axis."),
  ellipsoid: fn("3D Primitives", "ellipsoid(size): SDF3", "Creates an ellipsoid scaled along each axis."),
  pyramid: fn("3D Primitives", "pyramid(h): SDF3", "Creates a square pyramid."),
  tetrahedron: fn("3D Primitives", "tetrahedron(r): SDF3", "Creates a tetrahedron primitive."),
  octahedron: fn("3D Primitives", "octahedron(r): SDF3", "Creates an octahedron primitive."),
  dodecahedron: fn("3D Primitives", "dodecahedron(r): SDF3", "Creates a dodecahedron primitive."),
  icosahedron: fn("3D Primitives", "icosahedron(r): SDF3", "Creates an icosahedron primitive."),

  circle: fn("2D Primitives", "circle(radius = 1, center = ORIGIN2): SDF2", "Creates a 2D circle."),
  line: fn("2D Primitives", "line(normal = UP2, point = ORIGIN2): SDF2", "Creates a 2D half-space line."),
  slab2: fn("2D Primitives", "slab2({ x0, x1, y0, y1, k }): SDF2", "Builds a 2D bounded region from one or more axis-aligned lines."),
  rectangle: fn("2D Primitives", "rectangle(size = 1, center = ORIGIN2): SDF2", "Creates a rectangle from a scalar, vector size, or two corners."),
  rounded_rectangle: fn("2D Primitives", "rounded_rectangle(size, radius, center = ORIGIN2): SDF2", "Creates a rectangle with rounded corners."),
  equilateral_triangle: fn("2D Primitives", "equilateral_triangle(): SDF2", "Creates an equilateral triangle."),
  hexagon: fn("2D Primitives", "hexagon(radius): SDF2", "Creates a regular hexagon."),
  rounded_x: fn("2D Primitives", "rounded_x(width, radius): SDF2", "Creates a rounded X shape."),
  polygon: fn("2D Primitives", "polygon(points): SDF2", "Creates a 2D polygon from a list of points."),
  vesica: fn("2D Primitives", "vesica(radius, distance): SDF2", "Creates a vesica shape from two overlapping circles."),

  union: fn("CSG", "union(first, ...rest, { k? }): SDF", "Combines SDFs, optionally using smooth blending with k.", "function", GLOBAL_AND_METHOD),
  difference: fn("CSG", "difference(first, ...rest, { k? }): SDF", "Subtracts later SDFs from the first, optionally smoothing with k.", "function", GLOBAL_AND_METHOD),
  subtract: fn("CSG", "shape.subtract(...others, { k? }): SDF", "Method alias for difference.", "method"),
  intersection: fn("CSG", "intersection(first, ...rest, { k? }): SDF", "Keeps the overlapping region of the inputs.", "function", GLOBAL_AND_METHOD),
  blend: fn("CSG", "blend(first, ...rest, { k? }): SDF", "Smoothly blends SDFs together.", "function", GLOBAL_AND_METHOD),
  negate: fn("CSG", "negate(shape): SDF", "Inverts the inside and outside of an SDF.", "function", GLOBAL_AND_METHOD),
  dilate: fn("CSG", "dilate(shape, radius): SDF", "Expands an SDF outward.", "function", GLOBAL_AND_METHOD),
  erode: fn("CSG", "erode(shape, radius): SDF", "Shrinks an SDF inward.", "function", GLOBAL_AND_METHOD),
  shell: fn("CSG", "shell(shape, thickness): SDF", "Turns a solid into a thin shell.", "function", GLOBAL_AND_METHOD),
  repeat: fn("CSG", "shape.repeat(spacing, count = null, padding = 0): SDF", "Repeats a shape across a grid.", "method"),

  k: fn("CSG", "shape.k(value): SDF", "Sets the smoothness used by the next CSG operation.", "method"),
  translate: fn("Transforms", "shape.translate(offset): SDF", "Moves a shape by a 2D or 3D vector.", "method"),
  scale: fn("Transforms", "shape.scale(factor): SDF", "Scales a shape by a scalar or per-axis factors.", "method"),
  rotate: fn("Transforms", "shape.rotate(angle, axis = Z): SDF", "Rotates a 2D shape by angle, or a 3D shape around an axis.", "method"),
  rotate_to: fn("Transforms", "shape.rotate_to(fromAxis, toAxis): SDF3", "Rotates a 3D shape so one axis points toward another.", "method"),
  rotateTo: fn("Transforms", "shape.rotateTo(fromAxis, toAxis): SDF3", "Camel-case alias for rotate_to.", "method"),
  orient: fn("Transforms", "shape.orient(axis): SDF3", "Rotates a 3D shape from UP to the target axis.", "method"),
  circular_array: fn("Transforms", "shape.circular_array(count, offset = 0): SDF", "Copies a shape around a circle.", "method"),
  circularArray: fn("Transforms", "shape.circularArray(count, offset = 0): SDF", "Camel-case alias for circular_array.", "method"),
  elongate: fn("Transforms", "shape.elongate(size): SDF", "Extends a primitive along each axis before evaluation.", "method"),
  twist: fn("Transforms", "shape.twist(k): SDF3", "Twists a 3D shape around the Z axis.", "method"),
  bend: fn("Transforms", "shape.bend(k): SDF3", "Bends a 3D shape with a constant curvature.", "method"),
  bend_linear: fn("Transforms", "shape.bend_linear(p0, p1, vector, ease = ease.linear): SDF3", "Bends a 3D shape along a linear transition.", "method"),
  bendLinear: fn("Transforms", "shape.bendLinear(p0, p1, vector, ease = ease.linear): SDF3", "Camel-case alias for bend_linear.", "method"),
  bend_radial: fn("Transforms", "shape.bend_radial(r0, r1, dz, ease = ease.linear): SDF3", "Bends a 3D shape through a radial transition.", "method"),
  bendRadial: fn("Transforms", "shape.bendRadial(r0, r1, dz, ease = ease.linear): SDF3", "Camel-case alias for bend_radial.", "method"),
  transition_linear: fn("Transforms", "transition_linear(a, b, p0 = -Z, p1 = Z, ease = ease.linear): SDF3", "Transitions between two 3D SDFs along a line."),
  transitionLinear: fn("Transforms", "shape.transitionLinear(other, p0 = -Z, p1 = Z, ease = ease.linear): SDF3", "Method alias for transition_linear.", "method"),
  transition_radial: fn("Transforms", "transition_radial(a, b, r0 = 0, r1 = 1, ease = ease.linear): SDF3", "Transitions between two 3D SDFs radially."),
  transitionRadial: fn("Transforms", "shape.transitionRadial(other, r0 = 0, r1 = 1, ease = ease.linear): SDF3", "Method alias for transition_radial.", "method"),
  wrap_around: fn("Transforms", "shape.wrap_around(x0, x1, radius = auto, ease = ease.linear): SDF3", "Wraps a 3D shape around the Z axis.", "method"),
  wrapAround: fn("Transforms", "shape.wrapAround(x0, x1, radius = auto, ease = ease.linear): SDF3", "Camel-case alias for wrap_around.", "method"),

  slice: fn("2D/3D", "shape.slice(): SDF2", "Takes a 2D slice through a 3D shape.", "method"),
  extrude: fn("2D/3D", "shape.extrude(height): SDF3", "Extrudes a 2D SDF into a 3D solid.", "method"),
  extrude_to: fn("2D/3D", "extrude_to(a, b, height, ease = ease.linear): SDF3", "Extrudes between two 2D SDF profiles."),
  extrudeTo: fn("2D/3D", "shape.extrudeTo(other, height, ease = ease.linear): SDF3", "Method alias for extrude_to.", "method"),
  revolve: fn("2D/3D", "shape.revolve(offset = 0): SDF3", "Revolves a 2D SDF into a 3D shape.", "method"),

  generate: fn("Workflow", "generate(sdf, options = {}): Promise<MeshResult>", "Builds a triangle mesh from a 3D SDF."),
  save: fn("Workflow", "save(filename, sdf, options = {}): Promise<Blob>", "Generates and optionally downloads an STL blob."),
  sample_slice: fn("Workflow", "sample_slice(sdf, options = {}): SliceSample", "Samples a signed-distance slice into a numeric grid."),
  show_slice: fn("Workflow", "show_slice(sdf, options = {}): HTMLCanvasElement", "Renders a signed-distance slice to a canvas."),

  PI: fn("Math", "const PI", "Math.PI re-exported for SDF source snippets.", "constant"),
  ORIGIN: fn("Math", "const ORIGIN: [0, 0, 0]", "3D origin vector.", "constant"),
  ORIGIN2: fn("Math", "const ORIGIN2: [0, 0]", "2D origin vector.", "constant"),
  X: fn("Math", "const X: [1, 0, 0]", "3D X axis.", "constant"),
  Y: fn("Math", "const Y: [0, 1, 0]", "3D Y axis.", "constant"),
  Z: fn("Math", "const Z: [0, 0, 1]", "3D Z axis.", "constant"),
  UP: fn("Math", "const UP: Z", "Default 3D up axis.", "constant"),
  X2: fn("Math", "const X2: [1, 0]", "2D X axis.", "constant"),
  Y2: fn("Math", "const Y2: [0, 1]", "2D Y axis.", "constant"),
  UP2: fn("Math", "const UP2: Y2", "Default 2D up axis.", "constant"),
  radians: fn("Math", "radians(degrees): number", "Converts degrees to radians."),
  degrees: fn("Math", "degrees(radians): number", "Converts radians to degrees."),
  add: fn("Math", "add(a, b): number[]", "Adds vectors component-wise."),
  sub: fn("Math", "sub(a, b): number[]", "Subtracts vectors component-wise."),
  mul: fn("Math", "mul(a, b): number[]", "Multiplies a vector by a scalar or another vector."),
  div: fn("Math", "div(a, b): number[]", "Divides a vector by a scalar or another vector."),
  normalize: fn("Math", "normalize(vector): number[]", "Returns a unit-length vector."),
  cross: fn("Math", "cross(a, b): number[]", "Computes a 3D cross product."),
  dot: fn("Math", "dot(a, b): number", "Computes a vector dot product."),
  length: fn("Math", "length(vector): number", "Computes vector length."),
  mix: fn("Math", "mix(a, b, t): number", "Linearly interpolates between two values."),
  clamp: fn("Math", "clamp(value, lo, hi): number", "Clamps a number to a range."),
  modulo: fn("Math", "modulo(value, divisor): number", "Positive modulo helper."),
};
