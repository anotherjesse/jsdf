export interface CallPatch {
  fns: string[];
  arg: number;
  element?: number;
}

const patch = (fns: string | string[], arg: number, element?: number): CallPatch => ({
  fns: Array.isArray(fns) ? fns : [fns],
  arg,
  ...(element == null ? {} : { element }),
});

export const CALL_PATCHES: Record<string, Record<string, CallPatch>> = {
  circle: {
    radius: patch("circle", 0),
    "center[0]": patch("circle", 1, 0),
    "center[1]": patch("circle", 1, 1),
  },
  line: {
    "normal[0]": patch("line", 0, 0),
    "normal[1]": patch("line", 0, 1),
    "point[0]": patch("line", 1, 0),
    "point[1]": patch("line", 1, 1),
  },
  rectangle: {
    "size[0]": patch("rectangle", 0, 0),
    "size[1]": patch("rectangle", 0, 1),
    "center[0]": patch("rectangle", 1, 0),
    "center[1]": patch("rectangle", 1, 1),
  },
  roundedRectangle: {
    "size[0]": patch("rounded_rectangle", 0, 0),
    "size[1]": patch("rounded_rectangle", 0, 1),
    "radius[0]": patch("rounded_rectangle", 1, 0),
    "radius[1]": patch("rounded_rectangle", 1, 1),
    "radius[2]": patch("rounded_rectangle", 1, 2),
    "radius[3]": patch("rounded_rectangle", 1, 3),
    "center[0]": patch("rounded_rectangle", 2, 0),
    "center[1]": patch("rounded_rectangle", 2, 1),
  },
  hexagon: { r: patch("hexagon", 0) },
  roundedX: {
    w: patch("rounded_x", 0),
    r: patch("rounded_x", 1),
  },
  vesica: {
    r: patch("vesica", 0),
    d: patch("vesica", 1),
  },
  sphere: {
    radius: patch("sphere", 0),
    "center[0]": patch("sphere", 1, 0),
    "center[1]": patch("sphere", 1, 1),
    "center[2]": patch("sphere", 1, 2),
  },
  plane: {
    "normal[0]": patch("plane", 0, 0),
    "normal[1]": patch("plane", 0, 1),
    "normal[2]": patch("plane", 0, 2),
    "point[0]": patch("plane", 1, 0),
    "point[1]": patch("plane", 1, 1),
    "point[2]": patch("plane", 1, 2),
  },
  box: {
    "size[0]": patch("box", 0, 0),
    "size[1]": patch("box", 0, 1),
    "size[2]": patch("box", 0, 2),
    "center[0]": patch("box", 1, 0),
    "center[1]": patch("box", 1, 1),
    "center[2]": patch("box", 1, 2),
  },
  roundedBox: {
    "size[0]": patch("rounded_box", 0, 0),
    "size[1]": patch("rounded_box", 0, 1),
    "size[2]": patch("rounded_box", 0, 2),
    radius: patch("rounded_box", 1),
  },
  wireframeBox: {
    "size[0]": patch("wireframe_box", 0, 0),
    "size[1]": patch("wireframe_box", 0, 1),
    "size[2]": patch("wireframe_box", 0, 2),
    thickness: patch("wireframe_box", 1),
  },
  cylinder: { radius: patch("cylinder", 0) },
  roundedCylinder: {
    ra: patch("rounded_cylinder", 0),
    rb: patch("rounded_cylinder", 1),
    h: patch("rounded_cylinder", 2),
  },
  cappedCylinder: {
    "a[0]": patch("capped_cylinder", 0, 0),
    "a[1]": patch("capped_cylinder", 0, 1),
    "a[2]": patch("capped_cylinder", 0, 2),
    "b[0]": patch("capped_cylinder", 1, 0),
    "b[1]": patch("capped_cylinder", 1, 1),
    "b[2]": patch("capped_cylinder", 1, 2),
    radius: patch("capped_cylinder", 2),
  },
  torus: {
    r1: patch("torus", 0),
    r2: patch("torus", 1),
  },
  capsule: {
    "a[0]": patch("capsule", 0, 0),
    "a[1]": patch("capsule", 0, 1),
    "a[2]": patch("capsule", 0, 2),
    "b[0]": patch("capsule", 1, 0),
    "b[1]": patch("capsule", 1, 1),
    "b[2]": patch("capsule", 1, 2),
    radius: patch("capsule", 2),
  },
  cappedCone: {
    "a[0]": patch("capped_cone", 0, 0),
    "a[1]": patch("capped_cone", 0, 1),
    "a[2]": patch("capped_cone", 0, 2),
    "b[0]": patch("capped_cone", 1, 0),
    "b[1]": patch("capped_cone", 1, 1),
    "b[2]": patch("capped_cone", 1, 2),
    ra: patch("capped_cone", 2),
    rb: patch("capped_cone", 3),
  },
  roundedCone: {
    r1: patch("rounded_cone", 0),
    r2: patch("rounded_cone", 1),
    h: patch("rounded_cone", 2),
  },
  ellipsoid: {
    "size[0]": patch("ellipsoid", 0, 0),
    "size[1]": patch("ellipsoid", 0, 1),
    "size[2]": patch("ellipsoid", 0, 2),
  },
  pyramid: { h: patch("pyramid", 0) },
  tetrahedron: { r: patch("tetrahedron", 0) },
  octahedron: { r: patch("octahedron", 0) },
  dodecahedron: { r: patch("dodecahedron", 0) },
  icosahedron: { r: patch("icosahedron", 0) },
  dilate: { r: patch("dilate", 0) },
  erode: { r: patch("erode", 0) },
  shell: { thickness: patch("shell", 0) },
  translate: {
    "offset[0]": patch("translate", 0, 0),
    "offset[1]": patch("translate", 0, 1),
    "offset[2]": patch("translate", 0, 2),
  },
  scale: {
    "factor[0]": patch("scale", 0, 0),
    "factor[1]": patch("scale", 0, 1),
    "factor[2]": patch("scale", 0, 2),
  },
  circularArray2: { count: patch(["circular_array", "circularArray"], 0) },
  circularArray3: {
    count: patch(["circular_array", "circularArray"], 0),
    offset: patch(["circular_array", "circularArray"], 1),
  },
  elongate2: {
    "size[0]": patch("elongate", 0, 0),
    "size[1]": patch("elongate", 0, 1),
  },
  elongate3: {
    "size[0]": patch("elongate", 0, 0),
    "size[1]": patch("elongate", 0, 1),
    "size[2]": patch("elongate", 0, 2),
  },
  twist: { k: patch("twist", 0) },
  bend: { k: patch("bend", 0) },
  bendLinear: {
    "p0[0]": patch(["bend_linear", "bendLinear"], 0, 0),
    "p0[1]": patch(["bend_linear", "bendLinear"], 0, 1),
    "p0[2]": patch(["bend_linear", "bendLinear"], 0, 2),
    "p1[0]": patch(["bend_linear", "bendLinear"], 1, 0),
    "p1[1]": patch(["bend_linear", "bendLinear"], 1, 1),
    "p1[2]": patch(["bend_linear", "bendLinear"], 1, 2),
  },
  bendRadial: {
    r0: patch(["bend_radial", "bendRadial"], 0),
    r1: patch(["bend_radial", "bendRadial"], 1),
    dz: patch(["bend_radial", "bendRadial"], 2),
  },
  transitionLinear: {
    "p0[0]": patch(["transition_linear", "transitionLinear"], 1, 0),
    "p0[1]": patch(["transition_linear", "transitionLinear"], 1, 1),
    "p0[2]": patch(["transition_linear", "transitionLinear"], 1, 2),
    "p1[0]": patch(["transition_linear", "transitionLinear"], 2, 0),
    "p1[1]": patch(["transition_linear", "transitionLinear"], 2, 1),
    "p1[2]": patch(["transition_linear", "transitionLinear"], 2, 2),
  },
  transitionRadial: {
    r0: patch(["transition_radial", "transitionRadial"], 1),
    r1: patch(["transition_radial", "transitionRadial"], 2),
  },
  wrapAround: {
    x0: patch(["wrap_around", "wrapAround"], 0),
    x1: patch(["wrap_around", "wrapAround"], 1),
    r: patch(["wrap_around", "wrapAround"], 2),
  },
  repeat: {
    "spacing[0]": patch("repeat", 0, 0),
    "spacing[1]": patch("repeat", 0, 1),
    "spacing[2]": patch("repeat", 0, 2),
    "count[0]": patch("repeat", 1, 0),
    "count[1]": patch("repeat", 1, 1),
    "count[2]": patch("repeat", 1, 2),
    "padding[0]": patch("repeat", 2, 0),
    "padding[1]": patch("repeat", 2, 1),
    "padding[2]": patch("repeat", 2, 2),
  },
  extrude: { h: patch("extrude", 0) },
  extrudeTo: { h: patch(["extrude_to", "extrudeTo"], 1) },
  revolve: { offset: patch("revolve", 0) },
};

export const EXTRA_NODE_CALLS: Record<string, string[]> = {
  blend: ["blend"],
  difference: ["difference", "subtract"],
  equilateralTriangle: ["equilateral_triangle", "equilateralTriangle"],
  intersection: ["intersection"],
  negate: ["negate"],
  polygon: ["polygon"],
  rotate2: ["rotate"],
  rotate3: ["rotate", "rotate_to", "rotateTo", "orient"],
  slice: ["slice"],
  union: ["union"],
};

export const CSG_NODE_KINDS = new Set(["union", "difference", "intersection", "blend"]);
