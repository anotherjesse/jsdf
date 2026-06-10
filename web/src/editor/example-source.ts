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

  pagoda: `const column = rounded_box([0.22, 0.22, 1.7], 0.05);
const columns = union(
  column.translate([-1.1, 0, -0.1]),
  column.translate([1.1, 0, -0.1]),
  column.scale([0.8, 0.8, 0.72]).translate([0, 0, -0.35]),
);
let roof = rounded_box([2.9, 0.42, 0.18], 0.06).translate([0, 0, 0.92]);
roof = roof.union(rounded_box([2.25, 0.34, 0.16], 0.05).translate([0, 0, 1.18]).k(0.04));
roof = roof.union(rounded_box([1.55, 0.28, 0.14], 0.05).translate([0, 0, 1.42]).k(0.04));
const lantern = capped_cone([0, -0.34, 0.26], [0, -0.34, 0.72], 0.18, 0.08);
return union(columns, roof, lantern);`,

  coral: `const stem = capped_cylinder([0, 0, -0.9], [0, 0, 0.45], 0.12);
const branch = capsule([0, 0, -0.1], [0.85, 0, 0.62], 0.085);
const highBranch = capsule([0, 0, 0.15], [0.52, 0, 1.02], 0.07).rotate(0.38, Z);
const tips = sphere(0.16).translate([0.86, 0, 0.64]).circular_array(9, 0.18);
return union(
  sphere(0.34).translate([0, 0, -0.92]),
  stem,
  branch.circular_array(9, 0.18),
  highBranch.circular_array(6, 0.42),
  tips,
  { k: 0.18 },
);`,

  crystals: `const core = dodecahedron(0.72).scale([1, 0.85, 1.25]).rotate(0.28, Z);
const shard = octahedron(0.46).scale([0.55, 0.55, 1.85]).translate([0.96, 0, 0.32]).rotate(0.2, Y);
const lowShard = icosahedron(0.38).scale([0.7, 0.7, 1.45]).translate([0.68, 0, -0.42]).rotate(-0.34, Y);
return union(
  core,
  shard.circular_array(7, 0.14),
  lowShard.circular_array(5, 0.48),
  octahedron(0.34).translate([0, 0, 1.28]),
);`,

  halo: `const tile = rounded_box([0.28, 0.95, 0.18], 0.05).translate([0, 1.18, 0]).rotate(0.34, Z);
const inner = rounded_box([0.18, 0.58, 0.14], 0.04).translate([0, 0.77, 0.28]).rotate(-0.18, Z);
return union(
  tile.circular_array(18, 0.1),
  inner.circular_array(18, 0.28),
  torus(1.02, 0.04),
);`,

  vessel: `let body = rounded_cone(0.86, 0.42, 1.9);
body = body.difference(rounded_cone(0.62, 0.24, 1.92).translate([0, 0, 0.1]));
body = body.union(torus(0.66, 0.08).translate([0, 0, 0.94]));
body = body.union(torus(0.38, 0.06).translate([0, 0, -0.94]));
return body;`,

  medal: `const starPoints = (outer, inner, count) => {
  return Array.from({ length: count * 2 }, (_, i) => {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i / (count * 2)) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
};
const star = polygon(starPoints(1.05, 0.44, 6)).extrude(0.2);
let medal = star.union(circle(0.68).extrude(0.16).translate([0, 0, 0.04]), { k: 0.04 });
medal = medal.difference(cylinder(0.16));
return medal;`,

  chain: `const flatLink = torus(0.54, 0.085).scale([1.18, 0.62, 1]).rotate(Math.PI / 2, X);
const crossLink = torus(0.54, 0.085).scale([1.18, 0.62, 1]).rotate(Math.PI / 2, Y);
return union(
  flatLink.translate([-0.8, 0, 0]),
  crossLink,
  flatLink.translate([0.8, 0, 0]),
  { k: 0.02 },
);`,

  bracket: `let plate = rounded_box([2.35, 1.22, 0.28], 0.1);
plate = plate.union(rounded_box([0.46, 1.22, 0.78], 0.09).translate([-0.94, 0, 0.25]).k(0.05));
plate = plate.union(rounded_box([0.46, 1.22, 0.78], 0.09).translate([0.94, 0, 0.25]).k(0.05));
plate = plate.difference(cylinder(0.2).translate([-0.72, 0, 0]));
plate = plate.difference(cylinder(0.2).translate([0.72, 0, 0]));
plate = plate.difference(cylinder(0.34).orient(X).translate([0, 0, 0.38]));
return plate;`,

  turbine: `const blade = rounded_box([1.25, 0.22, 0.12], 0.05).translate([0.68, 0, 0]).twist(0.36);
const fan = blade.circular_array(9, 0.12);
return union(
  fan,
  ellipsoid([0.32, 0.32, 0.14]),
  capped_cylinder([0, 0, -0.42], [0, 0, 0.42], 0.11),
  { k: 0.03 },
);`,
};

export function sourceForExample(id: string): string {
  return exampleSources[id] ?? exampleSources.canonical;
}
