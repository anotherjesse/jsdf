export const exampleSources: Record<string, string> = {
  canonical: `let f = intersection(sphere(1), box(1.5));
const c = cylinder(0.5);
f = f.difference(union(c.orient(X), c.orient(Y), c.orient(Z)));
return f;`,

  gearlike: `let f = intersection(sphere(2), slab({ z0: -0.5, z1: 0.5 }).k(0.1));
f = f.difference(cylinder(1).k(0.1));
f = f.difference(cylinder(0.25).circular_array(16, 2).k(0.1));
return f;`,

  blobby: `let s = union(
  sphere(0.75).translate(mul(Z, -3)),
  sphere(0.75).translate(mul(Z, 3)),
);
s = s.union(capsule(mul(Z, -3), mul(Z, 3), 0.5), { k: 1 });
return sphere(1.5).union(s.orient(X), s.orient(Y), s.orient(Z), { k: 1 });`,

  knurling: `let f = rounded_cylinder(1, 0.1, 5);
let x = box([1, 1, 4]).rotate(Math.PI / 4);
x = x.circular_array(24, 1.6);
x = union(x.twist(0.75), x.twist(-0.75));
f = f.difference(x.k(0.1));
f = f.difference(cylinder(0.5).k(0.1));
const c = cylinder(0.25).orient(X);
f = f.difference(c.translate(mul(Z, -2.5)).k(0.1));
f = f.difference(c.translate(mul(Z, 2.5)).k(0.1));
return f;`,

  pawn: `const section = (z0, z1, d0, d1, e = ease.linear) => {
  const f = cylinder(d0 / 2).transition_linear(cylinder(d1 / 2), mul(Z, z0), mul(Z, z1), e);
  return intersection(f, slab({ z0, z1 }));
};
let f = section(0, 0.2, 1, 1.25);
f = f.union(section(0.2, 0.3, 1.25, 1).k(0.05));
f = f.union(rounded_cylinder(0.6, 0.1, 0.2).translate(mul(Z, 0.4)).k(0.05));
f = f.union(section(0.5, 1.75, 1, 0.25, ease.out_quad).k(0.01));
f = f.union(section(1.75, 1.85, 0.25, 0.5).k(0.01));
f = f.union(section(1.85, 1.9, 0.5, 0.25).k(0.05));
f = f.union(sphere(0.3).translate(mul(Z, 2.15)).k(0.05));
return f.translate([0, 0, -1.1]);`,

  weave: `let f = rounded_box([3.2, 1, 0.25], 0.1).translate([1.5, 0, 0.0625]);
f = f.bend_linear(mul(X, 0.75), mul(X, 2.25), mul(Z, -0.1875), ease.in_out_quad);
f = f.circular_array(3, 0);
f = f.repeat([2.7, 5.4, 0], null, 1);
f = union(f, f.translate([2.7 / 2, 2.7, 0]));
f = intersection(f, cylinder(10));
return union(
  f,
  intersection(cylinder(12).difference(cylinder(10)), slab({ z0: -0.5, z1: 0.5 }).k(0.25)),
);`,

  extrude: `const a = hexagon(1).extrude(0.8).translate([-1.6, 0, 0]);
const b = rectangle(2).extrude_to(circle(1), 1.6, ease.in_out_quad).translate([1.4, 0, 0]);
const c = hexagon(0.45).revolve(2.2).translate([0, 0, -0.1]);
return union(a, b, c);`,

  deform: `const twisted = box([0.9, 0.9, 2.4]).twist(Math.PI / 2).translate([-1.7, 0, 0]);
const bent = capsule(mul(Z, -1.2), mul(Z, 1.2), 0.25)
  .bend_linear(mul(Z, -0.8), mul(Z, 0.8), X, ease.in_out_quad);
const radial = box([2.6, 2.6, 0.18])
  .bend_radial(0.6, 1.5, -0.7, ease.in_out_quad)
  .translate([1.8, 0, 0]);
return union(twisted, bent, radial);`,

  primitives: `const solids = [
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
return out;`,
};

export function sourceForExample(id: string): string {
  return exampleSources[id] ?? exampleSources.canonical;
}
