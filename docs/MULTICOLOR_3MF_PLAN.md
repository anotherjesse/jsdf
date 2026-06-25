# Multicolor 3MF Export Plan

This is a research and implementation plan for adding color-aware 3MF export to
the SDF browser without making the modeling API feel heavy.

The north star:

- Geometry stays a scalar signed-distance graph.
- Names and colors are inert annotations on that graph.
- Preview and export are processes that interpret those annotations.
- STL remains geometry-only.

## User Journey

The happy path should feel like this:

1. Model a shape as usual.
2. Mark visible regions with simple names and colors.
3. Preview those colors in the browser.
4. Download a `.3mf`.
5. Open the file in a slicer and assign the visible colors to printer
   filaments/material slots.

Example:

```js
const body = rounded_box([2, 1, 0.4], 0.08)
  .name("body")
  .color("#0f766e");

const badge = cylinder(0.18)
  .translate([0.6, 0, 0.24])
  .name("badge")
  .color("#facc15");

const shape = union(body, badge, { k: 0.03 });

void save3mf("badge-box.3mf", shape);
return shape;
```

The `return shape` keeps the browser preview working. The `void save3mf(...)`
call starts an explicit export/download workflow from editor code, matching the
existing mesh workflow pattern.

## Goals

- Keep signed distance evaluation scalar and simple.
- Let users annotate regions with names and colors.
- Export a multicolor `.3mf` package where resolved surface colors can be
  assigned to slicer materials or printer filaments.
- Preserve existing STL export behavior.
- Avoid forcing every primitive signature to grow color/material options.
- Make ambiguity visible through reports and warnings instead of hiding it.

## Non-goals

- Do not make STL multicolor. STL should remain geometry-only.
- Do not make `evaluate2` or `evaluate3` return rich distance/material objects.
- Do not treat user-facing names as globally unique identities.
- Do not treat display color, printable material, slicer object, and 3MF part
  identity as the same concept.
- Do not try full physically based material modeling in the SDF API.
- Do not promise all slicers interpret 3MF material metadata identically until
  tested.

## Vocabulary Boundaries

These ideas are related, but they should stay separate:

- **Label/name**: a human-readable annotation such as `"body"` or `"badge"`.
  Names are allowed to repeat. They are not identity.
- **Color**: an sRGB display/export color such as `"#ef4444"`. Color is not a
  filament slot or physical material.
- **Material**: a future manufacturing concept such as `"red-pla"` with a
  display color, slicer slot, type, and vendor/profile metadata.
- **Part**: a manufacturing or slicer-visible unit. A part may have a name and a
  material, but not every name or color should imply a separate part.
- **3MF object**: a resource inside the 3MF model. It may carry a `name`
  attribute, but slicers vary in how visibly they expose that name.
- **3MF package part**: an OPC file inside the `.3mf` ZIP package. This is a
  packaging term, not the same as a printable part.

Use "surface color export" for the first implementation. Use "part export" only
for explicit split-object workflows after slicer testing.

## Naming and Color Model

Recommended API shape:

```js
shape.name("body")
shape.color("#0f766e")
```

Add two separate wrapper annotations:

- `shape.name("foo")`: pass-through graph annotation for readability, graph UI,
  source UI, and optional 3MF object names in split-object exports.
- `shape.color("#rrggbb" | [r, g, b])`: pass-through graph annotation for
  preview color and 3MF color properties.

Names and colors should not replace each other. A name is a label. A color is
display/export intent. Keeping them separate lets users build color-neutral
models and recolor them at export time:

```js
const shape = union(
  rounded_box([2, 1, 0.4], 0.08).name("body"),
  cylinder(0.18).translate([0.6, 0, 0.24]).name("badge"),
);

void save3mf("badge-box.3mf", shape, {
  colorsByName: {
    body: "#0f766e",
    badge: "#facc15",
  },
});

return shape;
```

Rules:

- Same name can appear in multiple places.
- Same color can appear under multiple names.
- Neither name nor color implies separate geometry.
- `.color()` accepts display colors only in v1.
- `.material(...)`, `.part(...)`, `.tag(...)`, and stable `.id(...)` should wait
  until the export model has real material/part semantics.

Avoid adding this convenience API in v1:

```js
shape.part("badge", "#facc15")
```

It is attractive for beginners, but it joins label, color, material intent, and
part identity too early.

## Do 3MF Files Have Part Names?

Yes, with a terminology caveat.

In 3MF, an OPC package "part" can mean a file inside the `.3mf` ZIP package. The
printable model itself is described with 3MF object resources and build items.
The core 3MF object resource supports a `name` attribute for readability and a
`partnumber` attribute for production/derivation workflows. The Production
Extension adds stronger unique-identification machinery for production builds.

Plan:

- In v1, write `.name("foo")` to the 3MF object `name` attribute only when we
  intentionally emit separate object resources.
- Do not write `.name()` to `partnumber` in v1. A human label is not production
  identity.
- Test slicer UI behavior in PrusaSlicer, Bambu Studio, and OrcaSlicer before
  documenting exact user-visible name behavior.

References:

- 3MF Core Specification: object attributes include `name` and `partnumber`.
  https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md
- 3MF Production Extension: unique IDs for builds, objects, and part copies.
  https://github.com/3MFConsortium/spec_production/blob/master/3MF%20Production%20Extension.md

## Internal Graph Representation

Add wrapper node kinds:

- `name`: `{ name }`, one child, same dimension as child.
- `color`: `{ color }`, one child, same dimension as child.

Both wrappers are distance pass-through nodes:

```txt
distance(name(child), p) = distance(child, p)
distance(color(child), p) = distance(child, p)
```

Why wrapper nodes:

- They do not alter primitive signatures.
- They compose naturally with transforms and CSG.
- They can be shown or hidden in the graph inspector.
- They can be preserved through visible graph cloning and solo preview.
- They keep metadata out of primitive constructors.

Implementation notes:

- Add node kinds in `src/core/nodes.ts`.
- Add `name(...)` and `color(...)` methods on `SDF2` and `SDF3`.
- Add named functions if useful: `name(shape, value)`, `color(shape, value)`.
- Update CPU evaluators, GLSL compiler, and WGSL compiler to pass distance
  through these nodes.
- Update API reference, completions, and signature help.
- Hide raw color channel numbers from generic numeric scrub controls until a
  dedicated color swatch/editor exists.

## Annotation Resolution Rules

The preview/export path needs to answer: "at this surface point, what annotations
are nearest?"

Start with deterministic, simple rules:

- `color(child)` supplies the nearest enclosing display/export color.
- `name(child)` supplies the nearest enclosing label.
- Transforms and deformations forward annotation queries through the same
  coordinate mapping used for distance evaluation when possible.
- `union` chooses the child with the smaller distance.
- Smooth `union` may blend preview colors, but 3MF export remains discrete: each
  triangle receives one resolved color property.
- `difference` keeps the left/base annotation. Cutters do not assign print
  color by default.
- `intersection` chooses the child that defines the active boundary.
- `blend` may preview blended colors, but export chooses one dominant annotation.
- Uncolored geometry uses a default preview/export color.

Important caveats:

- Smooth blends are not true filament gradients. 3MF export is one color per
  triangle unless a later slicer-specific workflow proves otherwise.
- Triangle centroid sampling can mislabel triangles that cross annotation
  boundaries. Track this in export reports and consider boundary subdivision in
  a later phase.
- Coincident or equal-distance ownership should be deterministic and warned
  about.

This preserves the most important default expectation: subtractive holes do not
become the cutter's color.

## Phase 1: Metadata API and Preview Color

Deliverables:

- Add `.name(...)` and `.color(...)` graph wrappers.
- Keep distance-only evaluation unchanged externally.
- Add an annotation resolver for CPU-side inspection and tests.
- Add raymarch preview coloring using generated `sceneColor(p)` GLSL or an
  equivalent generated helper.
- Add mesh preview coloring either by sampling `sceneColor(v_position)` in the
  shader or by uploading per-vertex color later.
- Add basic graph inspector display for name/color nodes.
- Add docs showing the basic user journey.

Verification:

- Existing API/runtime checks still pass.
- Colored and uncolored examples compile to GLSL/WGSL.
- Preview screenshots show distinct colors.
- Source links still work for ordinary geometry edits.
- Duplicate names do not crash or imply identity.

## Phase 2: 3MF Surface Color Export

This is the first printable export phase. It should not claim that color equals
part. It should export resolved surface colors as 3MF material/color properties.

User-facing behavior:

```js
const body = rounded_box([2, 1, 0.4], 0.08)
  .name("body")
  .color("#0f766e");

const logo = cylinder(0.16)
  .translate([0.55, 0, 0.25])
  .name("logo")
  .color("#f43f5e");

const shape = union(body, logo, { k: 0.02 });

void save3mf("box.3mf", shape);
return shape;
```

Export policy:

- Build one final mesh as we do today.
- Assign each triangle one resolved label/color by sampling near the triangle
  surface.
- Emit 3MF material/color definitions and per-triangle material/color
  properties.
- Unnamed colors get generated labels like `color-f43f5e`.
- Uncolored geometry exports as `default`.
- Existing `save("part.stl", shape)` remains unchanged.

Export report:

`save3mf` should return or expose an export report, even if editor examples use
`void` to start a download:

```ts
interface ThreeMfExportReport {
  triangles: number;
  colors: Array<{ color: string; triangles: number; labels: string[] }>;
  warnings: string[];
  ambiguousTriangles: number;
  compatibility: "generic" | "prusa" | "bambu" | "orca";
}
```

Report warnings should cover:

- Duplicate labels used for recoloring.
- Missing colors for labels in strict mode.
- Ambiguous ownership at equal-distance or smooth CSG boundaries.
- Tiny material islands.
- Slicer compatibility fallbacks.

Implementation options to spike:

1. Single final mesh with per-triangle material/color properties.
   - Pros: one final shell; closest to slicer paint workflows.
   - Cons: slicer support varies; object names may be less visible.

2. Multiple 3MF object resources, one per material/name group.
   - Pros: aligns with the user's "color as part" mental model.
   - Cons: grouping final-surface triangles can create open shells; generating
     true closed volumes per material is harder.

3. Hybrid export.
   - Emit separate named objects only when graph structure clearly represents
     separate unioned solids.
   - Fall back to per-triangle color properties for complex CSG, smooth CSG,
     blends, and ambiguous ownership.

Recommended initial implementation:

- Make option 1 the default.
- Do not ship `splitBy` as a core promise until slicer testing proves what works.
- If needed, hide `splitBy: "material"` or `splitBy: "name"` behind an
  experimental option that clearly warns about non-closed split surfaces.

This gets useful multicolor output without solving volumetric material
partitioning on day one.

## Phase 3: Name-Based Recoloring

Add label-aware export options:

```js
void save3mf("lamp.3mf", shape, {
  colorsByName: {
    base: "#111827",
    shade: "#f8fafc",
    switch: "#ef4444",
  },
});
```

Behavior:

- `colorsByName` maps nearest enclosing `.name(...)` labels to export colors.
- Explicit `.color(...)` in the graph is the default color.
- Export options may override graph colors when the user asks for recoloring.
- Duplicate names are allowed, so `colorsByName.body` recolors all regions with
  nearest label `"body"`.
- Use `strict: true` to fail on missing labels, unresolved colors, or ambiguous
  duplicate handling once strict mode exists.

This phase makes `.name("foo")` useful even for users who want to keep model
source color-neutral.

Beginner docs should call this "recolor by name." Advanced docs can call it
"label-based export color mapping."

## Phase 4: Advanced Manufacturing Controls

Do not put these in v1, but keep room for them.

Potential APIs:

```js
const redPla = material("red-pla", {
  color: "#ef4444",
  displayName: "Red PLA",
  slot: 2,
  type: "PLA",
});

const body = rounded_box([2, 1, 0.4], 0.08)
  .material("teal-pla");

await export3mf(shape, {
  compatibility: "bambu",
  units: "mm",
  materials: { "red-pla": redPla },
  strict: true,
});
```

Future controls:

- `.material(id)` for printable material identity.
- `.tag("buttons")` for selector-based recoloring.
- `.priority(value)` for overlapping SDF ownership.
- `.part(id, { name, partNumber, material })` only when we have clear part
  semantics.
- `export3mf(...)` as a non-download API for automation.
- `save3mf(...)` as a download convenience wrapper.
- `shape.explainAnnotationAt(p)` or similar for debugging.
- Selector-based recoloring such as `{ "tag:buttons": "#111827" }`.

Possible advanced export options:

- `compatibility`: `"generic" | "prusa" | "bambu" | "orca"`
- `units`: `"mm" | "inch" | "meter" | ...`
- `strict`: fail instead of warning.
- `materialBoundary`: `"centroid" | "subdivide"`
- `ownership`: `"distance" | "priority"`
- `splitMode`: `"none" | "paintedMesh" | "splitOpenSurfaces" |
  "splitClosedVolumes" | "multiStlZip" | "hybrid"`

These options should be driven by actual slicer compatibility tests, not by
speculation.

## Phase 5: Library and Writer Decision

Candidate paths:

1. Focused in-repo writer.
   - Add a small ZIP dependency such as `jszip` or `fflate`.
   - Generate `[Content_Types].xml`, `_rels/.rels`, and `/3D/3dmodel.model`.
   - Add Materials and Properties extension XML only for color export.
   - Pros: maps directly to our `Triangle[]` and resolved annotations.
   - Cons: we own compatibility bugs.

2. `@3mfconsortium/lib3mf`.
   - Official WASM wrapper around lib3mf.
   - Pros: strongest standards confidence.
   - Cons: larger dependency and lower-level integration.

3. Three.js exporters.
   - `three-3mf-exporter` and `threejs-exporter-pc` can export colored Three.js
     scenes.
   - Pros: high-level Blob output.
   - Cons: we do not currently use Three.js; packages are small/young and may
     require adapter objects anyway.

Recommendation:

- Start with a focused in-repo writer for the minimal 3MF we need.
- Keep the writer behind a small function boundary.
- Avoid a formal adapter abstraction until there is a second implementation.
- Use golden package tests so a later lib3mf swap has objective behavior to
  match.

## Phase 6: Slicer Compatibility Matrix

Create fixtures:

- Two disjoint colored regions.
- Two overlapping colored regions.
- Smooth union of two colors.
- Difference cutter with a different color.
- Named but uncolored regions with `colorsByName`.
- Same color across two different names.
- Duplicate names across separate branches.
- Tiny colored details.
- Unicode and XML-sensitive names.

Test in:

- PrusaSlicer
- Bambu Studio
- OrcaSlicer
- Windows 3D Viewer or another neutral 3MF viewer

Record:

- Are object names visible?
- Are color/material names visible?
- Are colors preserved?
- Can colors map to filaments/extruders?
- Does per-triangle coloring work?
- Does split-by-material object export work?
- Are grouped triangle objects accepted if they are not closed solids?
- Which export metadata is ignored by each slicer?

## User-Facing Documentation Needed

- Minimal colored export.
- Two-color printable object with expected slicer result.
- Recolor-by-name export.
- Difference example showing cutter color does not appear in the exported hole.
- Smooth union example showing preview blend versus discrete exported colors.
- Browser UI export flow versus code-triggered export.
- "Open in slicer" walkthrough for PrusaSlicer, Bambu Studio, and OrcaSlicer.
- Troubleshooting table for missing colors, missing names, one-object imports,
  filament assignment problems, and overlapping colored regions.

## Open Questions

- Should `.color()` accept only hex and numeric RGB in v1, or also CSS color
  names?
- How should color work through `repeat` and arrays if users want alternating
  colors?
- Should smooth CSG export blended color as surface paint, or always discrete
  child ownership?
- When is boundary subdivision worth the added complexity?
- Should mesh export support both `.3mf` and `.zip` of per-color STLs?
- How much slicer-specific metadata should we include for Bambu/Prusa profiles?
- What exact behavior should strict mode enforce?

## Minimal Success Criteria

- Existing STL export is unchanged.
- A user can write `sphere().name("button").color("#ef4444")`.
- Preview shows the color.
- `save3mf("model.3mf", shape)` downloads a valid 3MF package.
- The 3MF opens in at least PrusaSlicer and Bambu Studio.
- Resolved colors are visible enough for users to assign filaments.
- Export emits a useful report with triangle counts and warnings.
