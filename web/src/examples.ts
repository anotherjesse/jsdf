import {
  X,
  Y,
  Z,
  ease,
  box,
  capsule,
  capped_cylinder,
  circle,
  cylinder,
  hexagon,
  intersection,
  octahedron,
  rectangle,
  rounded_box,
  rounded_cylinder,
  slab,
  sphere,
  torus,
  union,
  type SDF3,
} from "./api";
import { intentionallyUnsupported } from "./api/completeness";
import { add, mul } from "./core/math";

export interface Example {
  id: string;
  name: string;
  build: () => SDF3;
  bounds?: [number[], number[]];
  grid?: number;
}

function canonical(): SDF3 {
  let f = intersection(sphere(1), box(1.5)) as SDF3;
  const c = cylinder(0.5);
  f = f.difference(union(c.orient(X), c.orient(Y), c.orient(Z)) as SDF3);
  return f;
}

function gearlike(): SDF3 {
  let f = intersection(sphere(2), slab({ z0: -0.5, z1: 0.5 }).k(0.1)) as SDF3;
  f = f.difference(cylinder(1).k(0.1));
  f = f.difference(cylinder(0.25).circular_array(16, 2).k(0.1));
  return f;
}

function blobby(): SDF3 {
  let s = union(sphere(0.75).translate(mul(Z, -3)), sphere(0.75).translate(mul(Z, 3))) as SDF3;
  s = s.union(capsule(mul(Z, -3), mul(Z, 3), 0.5), { k: 1 });
  return sphere(1.5).union(s.orient(X), s.orient(Y), s.orient(Z), { k: 1 });
}

function knurling(): SDF3 {
  let f = rounded_cylinder(1, 0.1, 5);
  let x = box([1, 1, 4]).rotate(Math.PI / 4);
  x = x.circular_array(24, 1.6);
  x = union(x.twist(0.75), x.twist(-0.75)) as SDF3;
  f = f.difference(x.k(0.1));
  f = f.difference(cylinder(0.5).k(0.1));
  const c = cylinder(0.25).orient(X);
  f = f.difference(c.translate(mul(Z, -2.5)).k(0.1));
  f = f.difference(c.translate(mul(Z, 2.5)).k(0.1));
  return f;
}

function pawn(): SDF3 {
  const section = (z0: number, z1: number, d0: number, d1: number, e = ease.linear): SDF3 => {
    const f = cylinder(d0 / 2).transition_linear(cylinder(d1 / 2), mul(Z, z0), mul(Z, z1), e);
    return intersection(f, slab({ z0, z1 })) as SDF3;
  };
  let f = section(0, 0.2, 1, 1.25);
  f = f.union(section(0.2, 0.3, 1.25, 1).k(0.05));
  f = f.union(rounded_cylinder(0.6, 0.1, 0.2).translate(mul(Z, 0.4)).k(0.05));
  f = f.union(section(0.5, 1.75, 1, 0.25, ease.out_quad).k(0.01));
  f = f.union(section(1.75, 1.85, 0.25, 0.5).k(0.01));
  f = f.union(section(1.85, 1.9, 0.5, 0.25).k(0.05));
  f = f.union(sphere(0.3).translate(mul(Z, 2.15)).k(0.05));
  return f.translate([0, 0, -1.1]);
}

function weave(): SDF3 {
  let f = rounded_box([3.2, 1, 0.25], 0.1).translate([1.5, 0, 0.0625]);
  f = f.bend_linear(mul(X, 0.75), mul(X, 2.25), mul(Z, -0.1875), ease.in_out_quad);
  f = f.circular_array(3, 0);
  f = f.repeat([2.7, 5.4, 0], null, 1);
  f = union(f, f.translate([2.7 / 2, 2.7, 0])) as SDF3;
  f = intersection(f, cylinder(10)) as SDF3;
  return union(f, intersection(cylinder(12).difference(cylinder(10)), slab({ z0: -0.5, z1: 0.5 }).k(0.25)) as SDF3) as SDF3;
}

function extrudeRevolve(): SDF3 {
  const a = hexagon(1).extrude(0.8).translate([-1.6, 0, 0]);
  const b = rectangle(2).extrude_to(circle(1), 1.6, ease.in_out_quad).translate([1.4, 0, 0]);
  const c = hexagon(0.45).revolve(2.2).translate([0, 0, -0.1]);
  return union(a, b, c) as SDF3;
}

function deformationSet(): SDF3 {
  const twisted = box([0.9, 0.9, 2.4]).twist(Math.PI / 2).translate([-1.7, 0, 0]);
  const bent = capsule(mul(Z, -1.2), mul(Z, 1.2), 0.25).bend_linear(mul(Z, -0.8), mul(Z, 0.8), X, ease.in_out_quad);
  const radial = box([2.6, 2.6, 0.18]).bend_radial(0.6, 1.5, -0.7, ease.in_out_quad).translate([1.8, 0, 0]);
  return union(twisted, bent, radial) as SDF3;
}

function primitiveTray(): SDF3 {
  const solids = [
    sphere(0.45),
    box(0.8),
    rounded_box([0.8, 0.8, 0.8], 0.15),
    torus(0.38, 0.12),
    capped_cylinder(mul(Z, -0.45), mul(Z, 0.45), 0.32),
    octahedron(0.62),
  ];
  let out = solids[0].translate([-2.5, 0, 0]);
  solids.slice(1).forEach((solid, i) => {
    out = out.union(solid.translate([-2.5 + (i + 1), 0, 0]));
  });
  return out;
}

export const examples: Example[] = [
  { id: "canonical", name: "CSG example", build: canonical, bounds: [[-1.4, -1.4, -1.4], [1.4, 1.4, 1.4]], grid: 56 },
  { id: "gearlike", name: "Gearlike", build: gearlike, bounds: [[-2.2, -2.2, -0.7], [2.2, 2.2, 0.7]], grid: 60 },
  { id: "blobby", name: "Smooth blobby", build: blobby, bounds: [[-2.3, -2.3, -2.3], [2.3, 2.3, 2.3]], grid: 56 },
  { id: "knurling", name: "Knurling", build: knurling, bounds: [[-1.7, -1.7, -2.8], [1.7, 1.7, 2.8]], grid: 64 },
  { id: "pawn", name: "Pawn", build: pawn, bounds: [[-0.9, -0.9, -1.3], [0.9, 0.9, 1.3]], grid: 60 },
  { id: "weave", name: "Weave", build: weave, bounds: [[-4, -4, -0.8], [4, 4, 0.8]], grid: 56 },
  { id: "extrude", name: "Extrude/Revolve", build: extrudeRevolve, bounds: [[-3.2, -2.7, -1.1], [3.2, 2.7, 1.1]], grid: 56 },
  { id: "deform", name: "Deformations", build: deformationSet, bounds: [[-2.5, -1.7, -1.8], [2.8, 1.7, 1.8]], grid: 56 },
  { id: "primitives", name: "Primitive tray", build: primitiveTray, bounds: [[-3.2, -0.8, -0.8], [3.2, 0.8, 0.8]], grid: 52 },
];

export function currentExample(id: string): Example {
  return examples.find((example) => example.id === id) ?? examples[0];
}

export const unsupportedPythonApi = intentionallyUnsupported;

export const supportedSummary = {
  moduleExports: 47,
  sdf2Methods: 17,
  sdf3Methods: 27,
};
