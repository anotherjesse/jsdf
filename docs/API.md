# JavaScript SDF API

This is the browser-native JavaScript API for `sdf browser`. It is inspired by Michael Fogleman's original Python [`sdf`](https://github.com/fogleman/sdf) API, but the active implementation in this repository is TypeScript and runs in the browser.

Editor snippets run as plain JavaScript with the SDF API and `Math` already in scope. Do not import anything. Return an `SDF3`, or leave a final expression that evaluates to an `SDF3`.

```js
const f = intersection(sphere(10), box(15));
const c = cylinder(5);

return f.difference(
  union(c.orient(X), c.orient(Y), c.orient(Z)),
);
```

Use arrays for vectors, for example `[x, y, z]`. Scalar sizes expand to all axes where the function accepts either a number or vector. Angles are radians; use `radians(degrees)` when that reads better.

Unlike the original Python API, JavaScript cannot overload `|`, `&`, or `-`, so use `union`, `intersection`, `difference`, or the matching shape methods.

## Reference Conventions

The editor exposes the modeling API as globals, along with `Math`. You do not need imports inside the app. TypeScript code in this repository imports the same surface from [src/api](../src/api/index.ts), while package-style consumers can import from [src/index.ts](../src/index.ts).

Most operations are available in both named and method form:

```js
const a = box([30, 30, 5]);
const b = sphere(10);

const byFunction = difference(a, b);
const byMethod = a.difference(b);
return byFunction;
```

When the Python API used keyword arguments, the JavaScript API usually uses an options object. For example, smooth CSG uses a trailing `{ k }` object:

```js
return union(box([30, 30, 5]), sphere(10), { k: 2.5 });
```

The API keeps Python-style snake_case names for familiarity. Common multiword methods also have camelCase aliases, such as `rotateTo`, `circularArray`, `bendLinear`, `transitionRadial`, and `wrapAround`.

## Units And Scale

Distance and coordinate numbers are millimeters by convention. `sphere(10)` is a 10 mm radius sphere, `box([30, 20, 4])` is a 30 mm by 20 mm by 4 mm box, and `translate([0, 0, 5])` moves a shape 5 mm upward.

Mesh vertices are emitted in the same coordinates as the SDF model. 3MF export declares millimeters by default. STL has no unit metadata, so exported STL files should be treated as millimeters in slicers and CAD tools.

The same scale applies to bounds, shell thickness, fillets, smooth CSG `k`, and mesh `step` values. `scale(factor)` is unitless; angles are radians.

## Names And Colors

Names and colors are annotations. They do not change the signed distance field, so evaluation, CSG, transforms, and STL export stay geometry-only.

```js
const body = rounded_box([20, 10, 4], 0.8)
  .name("body")
  .color("#0f766e");

const badge = cylinder(1.8)
  .translate([6, 0, 2.4])
  .name("badge")
  .color("#facc15");

return union(body, badge, { k: 0.3 });
```

Use `.name(label)` for a human-readable label and `.color("#rrggbb")` or `.color([r, g, b])` for preview/export color. Numeric color arrays can use either normalized `0..1` channels or `0..255` channels. Subtractive cutters do not assign color to the cut surface by default; `base.difference(cutter.color("#ef4444"))` keeps the base color.

## Examples

The app includes browser examples in [src/examples.ts](../src/examples.ts). These examples are also available from the example picker in the editor, scaled to printable millimeter sizes.

| Gearlike | Knurling | Smooth blobby | Weave |
| --- | --- | --- | --- |
| ![gearlike](images/gearlike.png) | ![knurling](images/knurling.png) | ![blobby](images/blobby.png) | ![weave](images/weave.png) |
| ![gearlike render](images/gearlike.jpg) | ![knurling render](images/knurling.jpg) | ![blobby render](images/blobby.jpg) | ![weave render](images/weave.jpg) |

## Mesh Workflow

The default preview raymarches the SDF graph directly in WebGL, so you can work quickly without building triangles. Mesh generation is explicit: switch to Mesh in the UI, or call `generate` / `save` from JavaScript.

Once Mesh view has generated triangles, the viewport download controls offer both STL and 3MF exports.

```js
const shape = rounded_box([36, 16, 7], 2.4);
void generate(shape, { grid: 80, algorithm: "surface-net" })
  .then((mesh) => console.log(mesh.triangles.length));
void save("bracket.stl", shape, { grid: 96, download: true });
return shape;
```

Editor snippets are evaluated synchronously, so return the `SDF3` immediately. Use promise callbacks for workflow helpers from editor code, or use `await` from a browser console or your own async JavaScript.

### Bounds

Bounds are estimated automatically and padded before sampling. Infinite primitives such as `plane`, `slab`, and `cylinder` need to be combined with finite shapes, or supplied explicit bounds for mesh generation.

```js
const f = intersection(sphere(10), slab({ z0: -5, z1: 5 }));
void save("slice.stl", f, {
  bounds: [[-12, -12, -6], [12, 12, 6]],
  grid: 96,
  download: true,
});
return f;
```

### Resolution

There are four ways to control sampling resolution. `grid` is the simplest, `dims` is explicit per axis, `step` follows physical spacing, and `samples` asks for an approximate total sample count.

```js
const f = rounded_box([36, 16, 7], 2.4);
void generate(f, { grid: 80 });
void generate(f, { dims: [96, 48, 32] });
void generate(f, { step: [0.25, 0.25, 0.2] });
void generate(f, { samples: 250000 });
return f;
```

Use lower resolution while modeling, then increase it for final STL export.

### 3MF Color Export

Use `save3mf` when you want the generated mesh packaged as a `.3mf` with resolved per-triangle colors. The export uses `.color(...)` annotations, or `colorsByName` when you want to keep the model source color-neutral.

```js
const left = sphere(7).translate([-5.5, 0, 0]).name("left");
const right = sphere(7).translate([5.5, 0, 0]).name("right");
const shape = union(left, right);

void save3mf("two-color.3mf", shape, {
  grid: 96,
  colorsByName: {
    left: "#ef4444",
    right: "#22c55e",
  },
}).then(({ report }) => console.log(report.colors));

return shape;
```

`save3mf` returns a `{ blob, report }` object. The report includes triangle counts, resolved colors, labels, ambiguous boundary counts, and warnings. Smooth blends may preview as blended colors, but 3MF export assigns one resolved color per triangle.

### Without Saving

Generate a mesh directly when you want to inspect triangles, write your own exporter, or delay STL creation.

```js
const f = sphere(10);
void generate(f, { grid: 72 }).then((mesh) => {
  console.log(mesh.triangles.length);
  console.log(mesh.bounds, mesh.dims);
});
return f;
```

### Colored Preview

The shader and mesh previews read `.color(...)` annotations directly from the graph. STL export ignores them.

```js
const left = sphere(7).translate([-5.5, 0, 0]).name("left").color("#ef4444");
const right = sphere(7).translate([5.5, 0, 0]).name("right").color("#22c55e");
return union(left, right);
```

If you already have a `MeshResult` or triangle list, `write_binary_stl` creates a `Blob` and can optionally trigger a download.

```js
const f = sphere(10);
void generate(f, { grid: 72 }).then((mesh) => {
  const blob = write_binary_stl("sphere.stl", mesh, { download: false });
  console.log(blob.size);
});
return f;
```

Mesh options include:

- `grid`: uniform grid resolution, defaulting to the app's mesh setting
- `dims`: explicit `[nx, ny, nz]` grid dimensions
- `step`: scalar or vector sample spacing in millimeters
- `samples`: approximate total sample count
- `bounds`: explicit millimeter extents, `[[xmin, ymin, zmin], [xmax, ymax, zmax]]`
- `algorithm`: `"surface-net"` or `"tetra"`
- `maxTriangles`: stop generation once polygonization exceeds this triangle count
- `preferGPU`: use WebGPU sampling when available
- `preferWorker`: use Web Workers for CPU sampling fallbacks and polygonization when available
- `workers`: set to `1` to force main-thread polygonization

The browser mesh path accepts `batch_size`, `batchSize`, `sparse`, and `verbose` for Python-option compatibility, but they do not currently change browser sampling behavior.

## Slices

Use `sample_slice` or `show_slice` for debugging signed distances on a plane.

<img width=350 align="right" src="images/show_slice.png">

```js
const f = sphere(10).difference(cylinder(4.5));
const sample = sample_slice(f, { z: 0, w: 256, h: 256 });
const canvas = show_slice(f, { z: 0, abs: false });
return f;
```

Specify exactly one of `x`, `y`, or `z` to choose the slice plane. `show_slice` returns a canvas and is most useful from the browser console or custom snippets.

<br clear="right">

## Programmable Shapes

This is still JavaScript. Split models into functions, use loops and conditionals, and return the composed shape.

<img width=250 align="right" src="images/customizable_box.png">

```js
function peg(x, y) {
  return cylinder(1.2).translate([x, y, 0]);
}

let lid = rounded_box([30, 20, 1.8], 0.8);
for (const x of [-10, 10]) {
  for (const y of [-5.5, 5.5]) {
    lid = lid.union(peg(x, y), { k: 0.3 });
  }
}
return lid;
```

<br clear="right">

## How It Works

`SDF2` and `SDF3` values are lightweight graph objects. A primitive such as `sphere()` creates a node; chaining methods such as `.translate(...)` or `.difference(...)` creates new nodes that point at earlier nodes. The preview, graph inspector, GLSL compiler, WGSL compiler, evaluator, and mesh generator all walk that graph.

```js
const base = rounded_box([2, 1, 0.25], 0.08);
const holes = cylinder(0.12)
  .orient(X)
  .repeat([0, 0.55, 0], [0, 2, 0]);
return base.difference(holes);
```

Most methods return a new `SDF2` or `SDF3`, so it is safe to keep intermediate variables. The exception is `.k(value)`, which marks an operand with a smoothing hint for the next CSG operation, matching the original Python idiom:

```js
const a = box([3, 3, 0.5]);
const b = sphere().k(0.25);
return a.union(b);
```

The browser API does not currently accept arbitrary JavaScript distance functions as custom primitives. Compose supported nodes instead so the renderer, graph inspector, source links, and mesh generator can all understand the model. The core graph objects live in [src/core/nodes.ts](../src/core/nodes.ts), and the exported modeling functions live in [src/api](../src/api/index.ts).

# Function Reference

## 3D Primitives

### sphere

<img width=128 align="right" src="images/sphere.png">

`sphere(radius = 1, center = ORIGIN): SDF3`

```js
const a = sphere();
const b = sphere(2);
const c = sphere(1, [1, 2, 3]);
return union(a, b.translate([3, 0, 0]), c.translate([-3, 0, 0]));
```

### box

<img width=128 align="right" src="images/box2.png">

`box(size = 1, center = ORIGIN): SDF3`

```js
const a = box(1);
const b = box([1, 2, 3]);
const c = box({ a: [-1, -1, -1], b: [3, 4, 5] });
return a;
```

### rounded_box

<img width=128 align="right" src="images/rounded_box.png">

`rounded_box(size, radius): SDF3`

```js
return rounded_box([1, 2, 3], 0.25);
```

### wireframe_box

<img width=128 align="right" src="images/wireframe_box.png">

`wireframe_box(size, thickness): SDF3`

```js
return wireframe_box([1, 2, 3], 0.05);
```

### torus

<img width=128 align="right" src="images/torus.png">

`torus(majorRadius, tubeRadius): SDF3`

```js
return torus(1, 0.25);
```

### capsule

<img width=128 align="right" src="images/capsule.png">

`capsule(a, b, radius): SDF3`

```js
return capsule(mul(Z, -1), Z, 0.5);
```

### capped_cylinder

<img width=128 align="right" src="images/capped_cylinder.png">

`capped_cylinder(a, b, radius): SDF3`

```js
return capped_cylinder(mul(Z, -1), Z, 0.5);
```

### rounded_cylinder

<img width=128 align="right" src="images/rounded_cylinder.png">

`rounded_cylinder(ra, rb, h): SDF3`

```js
return rounded_cylinder(0.5, 0.1, 2);
```

### capped_cone

<img width=128 align="right" src="images/capped_cone.png">

`capped_cone(a, b, ra, rb): SDF3`

```js
return capped_cone(mul(Z, -1), Z, 1, 0.5);
```

### rounded_cone

<img width=128 align="right" src="images/rounded_cone.png">

`rounded_cone(r1, r2, h): SDF3`

```js
return rounded_cone(0.75, 0.25, 2);
```

### ellipsoid

<img width=128 align="right" src="images/ellipsoid.png">

`ellipsoid(size): SDF3`

```js
return ellipsoid([1, 2, 3]);
```

### pyramid

<img width=128 align="right" src="images/pyramid.png">

`pyramid(h): SDF3`

```js
return pyramid(1);
```

## Platonic Solids

### tetrahedron

<img width=128 align="right" src="images/tetrahedron.png">

`tetrahedron(r): SDF3`

```js
return tetrahedron(1);
```

### octahedron

<img width=128 align="right" src="images/octahedron.png">

`octahedron(r): SDF3`

```js
return octahedron(1);
```

### dodecahedron

<img width=128 align="right" src="images/dodecahedron.png">

`dodecahedron(r): SDF3`

```js
return dodecahedron(1);
```

### icosahedron

<img width=128 align="right" src="images/icosahedron.png">

`icosahedron(r): SDF3`

```js
return icosahedron(1);
```

## Infinite 3D Primitives

These primitives extend to infinity in some axes. Use them with boolean operations or explicit bounds.

### plane

<img width=128 align="right" src="images/plane.png">

`plane(normal = UP, point = ORIGIN): SDF3`

```js
return intersection(sphere(), plane());
```

### slab

<img width=128 align="right" src="images/slab.png">

`slab({ x0, x1, y0, y1, z0, z1, k }): SDF3`

```js
return intersection(sphere(), slab({ z0: -0.5, z1: 0.5, x0: 0 }));
```

### cylinder

<img width=128 align="right" src="images/cylinder.png">

`cylinder(radius): SDF3`

```js
return sphere().difference(cylinder(0.5));
```

## Positioning

### translate

<img width=128 align="right" src="images/translate.png">

`shape.translate(offset): SDF`

```js
return sphere().translate([0, 0, 2]);
```

### scale

<img width=128 align="right" src="images/scale.png">

`shape.scale(factor): SDF`

Non-uniform scaling is useful, but it produces an inexact distance field.

```js
const a = sphere().scale(2);
const b = sphere().scale([1, 2, 3]).translate([3, 0, 0]);
return union(a, b);
```

### rotate

<img width=128 align="right" src="images/rotate.png">

`shape.rotate(angle, axis = Z): SDF`

For `SDF2`, omit the axis. For `SDF3`, the default axis is `Z`.

```js
return capped_cylinder(mul(Z, -1), Z, 0.5).rotate(PI / 4, X);
```

### rotate_to

`shape.rotate_to(fromAxis, toAxis): SDF3`

`rotateTo` is a camel-case alias.

```js
return capped_cylinder(mul(Z, -1), Z, 0.25).rotate_to(Z, X);
```

### orient

<img width=128 align="right" src="images/orient.png">

`shape.orient(axis): SDF3`

`orient` rotates a 3D shape from `UP` to the target axis.

```js
const c = capped_cylinder(mul(Z, -1), Z, 0.25);
return union(c.orient(X), c.orient(Y), c.orient(Z));
```

## Boolean Operations

The named functions and methods are equivalent:

```js
const a = box([3, 3, 0.5]);
const b = sphere();

const byFunction = union(a, b);
const byMethod = a.union(b);
return byFunction;
```

Each CSG operation accepts an optional trailing `{ k }` object for smooth blending. You can also call `shape.k(value)` to mark a child for smoothing in the next CSG operation.

### union

<img width=128 align="right" src="images/union.png">

`union(first, ...rest, { k? }): SDF`

```js
const a = box([3, 3, 0.5]);
const b = sphere();
return union(a, b);
```

### difference

<img width=128 align="right" src="images/difference.png">

`difference(first, ...rest, { k? }): SDF`

Method aliases are `shape.difference(...)` and `shape.subtract(...)`.

```js
const a = box([3, 3, 0.5]);
const b = sphere();
return difference(a, b);
```

### intersection

<img width=128 align="right" src="images/intersection.png">

`intersection(first, ...rest, { k? }): SDF`

```js
const a = box([3, 3, 0.5]);
const b = sphere();
return intersection(a, b);
```

### smooth union

<img width=128 align="right" src="images/smooth_union.png">

```js
const a = box([3, 3, 0.5]);
const b = sphere();
return union(a, b, { k: 0.25 });
```

### smooth difference

<img width=128 align="right" src="images/smooth_difference.png">

```js
const a = box([3, 3, 0.5]);
const b = sphere();
return difference(a, b, { k: 0.25 });
```

### smooth intersection

<img width=128 align="right" src="images/smooth_intersection.png">

```js
const a = box([3, 3, 0.5]);
const b = sphere();
return intersection(a, b, { k: 0.25 });
```

## Repetition

### repeat

<img width=128 align="right" src="images/repeat.png">

`shape.repeat(spacing, count = null, padding = 0): SDF`

`repeat` can repeat a shape infinitely or across a finite grid. If repeated elements overlap or come close together, set `padding` above zero so neighboring copies are considered.

```js
return sphere().repeat([3, 3, 0], [2, 2, 0], 1);
```

### circular_array

<img width=128 align="right" src="images/circular_array.png">

`shape.circular_array(count, offset = 0): SDF`

`circularArray` is a camel-case alias.

```js
return capped_cylinder(mul(Z, -1), Z, 0.5).circular_array(8, 4);
```

## Shape Operations

### blend

<img width=128 align="right" src="images/blend.png">

`blend(first, ...rest, { k? }): SDF`

```js
return blend(sphere(), box(), { k: 0.5 });
```

### negate

`negate(shape): SDF`

```js
return sphere().negate();
```

### dilate

<img width=128 align="right" src="images/dilate.png">

`dilate(shape, radius): SDF`

```js
return sphere().dilate(0.1);
```

### erode

<img width=128 align="right" src="images/erode.png">

`erode(shape, radius): SDF`

```js
return sphere().erode(0.1);
```

### shell

<img width=128 align="right" src="images/shell.png">

`shell(shape, thickness): SDF`

```js
return intersection(sphere().shell(0.05), plane(mul(Z, -1)));
```

### elongate

<img width=128 align="right" src="images/elongate.png">

`shape.elongate(size): SDF`

```js
return sphere().elongate([0.25, 0.5, 0.75]);
```

### twist

<img width=128 align="right" src="images/twist.png">

`shape.twist(k): SDF3`

```js
return box().twist(PI / 2);
```

### bend

<img width=128 align="right" src="images/bend.png">

`shape.bend(k): SDF3`

```js
return box().bend(1);
```

### bend_linear

<img width=128 align="right" src="images/bend_linear.png">

`shape.bend_linear(p0, p1, vector, ease = ease.linear): SDF3`

`bendLinear` is a camel-case alias.

```js
return capsule(mul(Z, -2), mul(Z, 2), 0.25)
  .bend_linear(mul(Z, -1), Z, X, ease.in_out_quad);
```

### bend_radial

<img width=128 align="right" src="images/bend_radial.png">

`shape.bend_radial(r0, r1, dz, ease = ease.linear): SDF3`

`bendRadial` is a camel-case alias.

```js
return box([5, 5, 0.25]).bend_radial(1, 2, -1, ease.in_out_quad);
```

### transition_linear

<img width=128 align="right" src="images/transition_linear.png">

`transition_linear(a, b, p0 = -Z, p1 = Z, ease = ease.linear): SDF3`

Method aliases are `shape.transition_linear(...)` and `shape.transitionLinear(...)`.

```js
return box().transition_linear(sphere(), mul(Z, -1), Z, ease.in_out_quad);
```

### transition_radial

<img width=128 align="right" src="images/transition_radial.png">

`transition_radial(a, b, r0 = 0, r1 = 1, ease = ease.linear): SDF3`

Method aliases are `shape.transition_radial(...)` and `shape.transitionRadial(...)`.

```js
return box().transition_radial(sphere(), 0, 1, ease.in_out_quad);
```

### wrap_around

<img width=128 align="right" src="images/wrap_around.png">

`shape.wrap_around(x0, x1, radius = auto, ease = ease.linear): SDF3`

`wrapAround` is a camel-case alias.

```js
return box([3, 0.2, 0.2]).wrap_around(-1.5, 1.5);
```

## 2D To 3D Operations

### extrude

<img width=128 align="right" src="images/extrude.png">

`shape.extrude(height): SDF3`

```js
return hexagon(1).extrude(1);
```

### extrude_to

<img width=128 align="right" src="images/extrude_to.png">

`extrude_to(a, b, height, ease = ease.linear): SDF3`

Method aliases are `shape.extrude_to(...)` and `shape.extrudeTo(...)`.

```js
return rectangle(2).extrude_to(circle(1), 2, ease.in_out_quad);
```

### revolve

<img width=128 align="right" src="images/revolve.png">

`shape.revolve(offset = 0): SDF3`

```js
return hexagon(1).revolve(3);
```

## 3D To 2D Operations

### slice

<img width=128 align="right" src="images/slice.png">

`shape.slice(): SDF2`

```js
return sphere().translate([0, 0, 0.55]).slice().extrude(0.1);
```

## 2D Primitives

2D shapes are useful when extruded, revolved, or used as intermediate profiles.

### circle

`circle(radius = 1, center = ORIGIN2): SDF2`

```js
return circle(1).extrude(0.2);
```

### line

`line(normal = UP2, point = ORIGIN2): SDF2`

```js
return intersection(circle(1), line()).extrude(0.2);
```

### slab2

`slab2({ x0, x1, y0, y1, k }): SDF2`

```js
return intersection(circle(1), slab2({ x0: -0.5, x1: 0.5 })).extrude(0.2);
```

### rectangle

`rectangle(size = 1, center = ORIGIN2): SDF2`

```js
return rectangle([1, 2]).extrude(0.2);
```

### rounded_rectangle

`rounded_rectangle(size, radius, center = ORIGIN2): SDF2`

```js
return rounded_rectangle([1, 2], 0.1).extrude(0.2);
```

### equilateral_triangle

`equilateral_triangle(): SDF2`

```js
return equilateral_triangle().extrude(0.2);
```

### hexagon

`hexagon(radius): SDF2`

```js
return hexagon(1).extrude(0.2);
```

### rounded_x

`rounded_x(width, radius): SDF2`

```js
return rounded_x(1, 0.1).extrude(0.2);
```

### polygon

`polygon(points): SDF2`

```js
return polygon([[0, 1], [-0.8, -0.6], [0.8, -0.6]]).extrude(0.2);
```

### vesica

`vesica(radius, distance): SDF2`

```js
return vesica(1, 0.45).extrude(0.2);
```

## Workflow Globals

### generate

`generate(sdf, options = {}): Promise<MeshResult>`

```js
const f = sphere();
void generate(f, { grid: 72 })
  .then((mesh) => console.log(mesh.triangles.length));
return f;
```

### save

`save(filename, sdf, options = {}): Promise<Blob>`

```js
const f = sphere();
void save("sphere.stl", f, { grid: 72, download: true });
return f;
```

`shape.generate(options)` and `shape.save(filename, options)` are method aliases.

### write_binary_stl

`write_binary_stl(filename, mesh, options = {}): Blob`

`mesh` can be either a `MeshResult` from `generate` or a raw triangle array. By default this triggers a browser download; pass `{ download: false }` when you only want the `Blob`.

```js
const f = sphere();
void generate(f, { grid: 72 }).then((mesh) => {
  const blob = write_binary_stl("sphere.stl", mesh, { download: false });
  console.log(blob.type, blob.size);
});
return f;
```

### sample_slice

`sample_slice(sdf, options = {}): SliceSample`

```js
const f = sphere();
const slice = sample_slice(f, { z: 0, w: 128, h: 128 });
console.log(slice.width, slice.height);
return f;
```

### show_slice

`show_slice(sdf, options = {}): HTMLCanvasElement`

```js
const f = sphere();
document.body.append(show_slice(f, { z: 0, w: 256, h: 256 }));
return f;
```

`shape.sample_slice(options)` and `shape.show_slice(options)` are method aliases.

## Constants And Math Helpers

### Constants

- `PI`: `Math.PI`
- `ORIGIN`: `[0, 0, 0]`
- `ORIGIN2`: `[0, 0]`
- `X`, `Y`, `Z`: 3D axes
- `UP`: alias for `Z`
- `X2`, `Y2`: 2D axes
- `UP2`: alias for `Y2`

### Helpers

- `radians(degrees): number`
- `degrees(radians): number`
- `add(a, b): number[]`
- `sub(a, b): number[]`
- `mul(a, b): number[]`
- `div(a, b): number[]`
- `normalize(vector): number[]`
- `cross(a, b): number[]`
- `dot(a, b): number`
- `length(vector): number`
- `mix(a, b, t): number`
- `clamp(value, lo, hi): number`
- `modulo(value, divisor): number`

```js
const post = capped_cylinder(mul(Z, -1), Z, 0.12);
return post.rotate(radians(30), X);
```

## Easing

The `ease` namespace contains named easing functions for bends, transitions, extrusion blends, and wraps.

```js
return rectangle(2).extrude_to(circle(1), 2, ease.in_out_quad);
```

Available names:

- `linear`
- `in_quad`, `out_quad`, `in_out_quad`
- `in_cubic`, `out_cubic`, `in_out_cubic`
- `in_quart`, `out_quart`, `in_out_quart`
- `in_quint`, `out_quint`, `in_out_quint`
- `in_sine`, `out_sine`, `in_out_sine`
- `in_expo`, `out_expo`, `in_out_expo`
- `in_circ`, `out_circ`, `in_out_circ`
- `in_elastic`, `out_elastic`, `in_out_elastic`
- `in_back`, `out_back`, `in_out_back`
- `in_bounce`, `out_bounce`, `in_out_bounce`
- `in_square`, `out_square`, `in_out_square`

## Unsupported Original Python APIs

The browser implementation intentionally does not include the original Python project's native/Python-heavy APIs:

- `text`, `image`, `measure_text`, and `measure_image`
- mesh loading and mesh-as-SDF APIs such as `Mesh.from_file` and `Mesh.sdf`

The original Python implementation and its full API history remain available at [github.com/fogleman/sdf](https://github.com/fogleman/sdf).
