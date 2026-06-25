export function renderConnectMarkdown({ base, projectBase, sessionId }) {
  return `# sdf Browser Session ${sessionId}

You are connected to a live local sdf browser session. The browser is the renderer; this API is a post office that asks the active tab to update code or capture the shader canvas.

Prefer comments that explain why you are taking an action, or what you are checking when the reason is not obvious.

## Quick Start

\`\`\`sh
BASE=${JSON.stringify(base)}
PROJECTS=${JSON.stringify(projectBase)}
MCP_URL="$BASE/mcp"

# List local projects/sessions and their latest thumbnails.
curl -s "$PROJECTS"

# Inspect the live browser session.
curl -s "$BASE/status"

# Read the current editor source.
curl -s "$BASE/code"

# Replace the editor source, wait for the shader screenshot, and create a snapshot.
curl -sS -X PUT "$BASE/code" \\
  -H 'content-type: application/json' \\
  --data-binary @update.json

# update.json:
# {
#   "comment": "Tightening the silhouette so the lid clears the printer envelope.",
#   "code": "const shape = box([1, 1, 1]);\\nreturn shape;"
# }

# Capture the current shader canvas as PNG and create a snapshot.
curl -s "$BASE/screenshot.png?comment=Checking%20the%20current%20front%20silhouette" -o screenshot.png

# List saved session snapshots.
curl -s "$BASE/snapshots"

# Restore a specific snapshot as the latest live editor state.
curl -sS -X POST "$BASE/snapshots/000002/restore" \\
  -H 'content-type: application/json' \\
  -d '{"comment":"Restoring snapshot 000002 as the new latest version."}'

# Restore code from the most recent different code snapshot.
curl -sS -X POST "$BASE/undo" \\
  -H 'content-type: application/json' \\
  -d '{"comment":"Backtracking to the last readable version before trying a smaller fillet."}'
\`\`\`

## MCP Connection

This same session can be added to an MCP client using Streamable HTTP:

\`\`\`text
${base}/mcp
\`\`\`

The MCP URL is session-specific. It exposes tools for status, reading code, setting code, capturing screenshots, listing snapshots, and restoring a snapshot as latest. Keep the matching \`/s/${sessionId}\` browser tab open; the tab still compiles, renders, and reports screenshots.

The session id is the local capability for this workspace. There is no separate secret in this first version.

## SDF Source API

Editor source is JavaScript executed with the SDF API globals already in scope, plus \`Math\`. Do not import anything. The code must produce an \`SDF3\`: either use an explicit top-level \`return\`, or leave a final expression that evaluates to an \`SDF3\`.

\`\`\`js
const trunk = capped_cylinder([0, 0, -0.9], [0, 0, -0.35], 0.12);
const boughs = union(
  capped_cone([0, 0, -0.55], [0, 0, 0.05], 0.7, 0.12),
  capped_cone([0, 0, -0.1], [0, 0, 0.55], 0.5, 0.08),
  capped_cone([0, 0, 0.3], [0, 0, 0.9], 0.32, 0.03),
  { k: 0.04 },
);
return union(trunk, boughs);
\`\`\`

Use arrays for vectors, for example \`[x, y, z]\`. Scalar sizes expand to all axes where the function accepts either a number or vector. Angles are radians; use \`radians(degrees)\` when that is clearer. Prefer the JavaScript API below, not the older Python operator style.

### 3D Primitives

- \`sphere(radius = 1, center = ORIGIN): SDF3\`
- \`plane(normal = UP, point = ORIGIN): SDF3\`
- \`slab({ x0, x1, y0, y1, z0, z1, k }): SDF3\`
- \`box(size = 1, center = ORIGIN): SDF3\`, where \`size\` may also be \`{ a, b }\` corners
- \`rounded_box(size, radius): SDF3\`
- \`wireframe_box(size, thickness): SDF3\`
- \`torus(majorRadius, tubeRadius): SDF3\`
- \`capsule(a, b, radius): SDF3\`
- \`cylinder(radius): SDF3\`, an infinite cylinder along Z
- \`capped_cylinder(a, b, radius): SDF3\`
- \`rounded_cylinder(ra, rb, h): SDF3\`
- \`capped_cone(a, b, radiusA, radiusB): SDF3\`
- \`rounded_cone(r1, r2, h): SDF3\`
- \`ellipsoid(size): SDF3\`
- \`pyramid(h): SDF3\`
- \`tetrahedron(r): SDF3\`
- \`octahedron(r): SDF3\`
- \`dodecahedron(r): SDF3\`
- \`icosahedron(r): SDF3\`

### 2D Primitives

2D shapes are useful when extruded or revolved into \`SDF3\`.

- \`circle(radius = 1, center = ORIGIN2): SDF2\`
- \`line(normal = UP2, point = ORIGIN2): SDF2\`
- \`slab2({ x0, x1, y0, y1, k }): SDF2\`
- \`rectangle(size = 1, center = ORIGIN2): SDF2\`, where \`size\` may also be \`{ a, b }\` corners
- \`rounded_rectangle(size, radius, center = ORIGIN2): SDF2\`
- \`equilateral_triangle(): SDF2\`
- \`hexagon(radius): SDF2\`
- \`rounded_x(width, radius): SDF2\`
- \`polygon(points): SDF2\`
- \`vesica(radius, distance): SDF2\`

### Names And Colors

Names and colors are annotations. They do not change the signed distance field, so evaluation, CSG, transforms, and STL export stay geometry-only.

- \`name(shape, label): SDF\`, or \`shape.name(label): SDF\`
- \`color(shape, "#rrggbb" | [r, g, b]): SDF\`, or \`shape.color(...): SDF\`

\`\`\`js
const body = rounded_box([2, 1, 0.4], 0.08)
  .name("body")
  .color("#0f766e");

const badge = cylinder(0.18)
  .translate([0.6, 0, 0.24])
  .name("badge")
  .color("#facc15");

return union(body, badge, { k: 0.03 });
\`\`\`

\`.name(...)\` is useful for readable source, graph labels, and \`colorsByName\` maps during 3MF export. \`.color(...)\` drives shader/mesh preview colors and 3MF triangle colors. Numeric color arrays can use normalized \`0..1\` channels or \`0..255\` channels. Subtractive cutters do not assign color to the cut surface by default; \`base.difference(cutter.color("#ef4444"))\` keeps the base color.

### CSG And Shape Operations

Most operations are available as globals and as methods. For example, \`union(a, b, { k: 0.1 })\` and \`a.union(b, { k: 0.1 })\` are equivalent. \`k\` enables smooth blending for that operation; \`shape.k(value)\` marks the shape with a smoothness value used by the next CSG operation.

- \`union(first, ...rest, { k? }): SDF\`
- \`difference(first, ...rest, { k? }): SDF\`; method aliases: \`shape.difference(...)\`, \`shape.subtract(...)\`
- \`intersection(first, ...rest, { k? }): SDF\`
- \`blend(first, ...rest, { k? }): SDF\`
- \`negate(shape): SDF\`, or \`shape.negate()\`
- \`dilate(shape, radius): SDF\`, or \`shape.dilate(radius)\`
- \`erode(shape, radius): SDF\`, or \`shape.erode(radius)\`
- \`shell(shape, thickness): SDF\`, or \`shape.shell(thickness)\`
- \`shape.repeat(spacing, count = null, padding = 0): SDF\`

### Transforms

- \`shape.translate(offset): SDF\`
- \`shape.scale(factor): SDF\`
- \`shape.rotate(angle, axis = Z): SDF\`; for \`SDF2\`, omit the axis
- \`shape.rotate_to(fromAxis, toAxis): SDF3\`, alias \`shape.rotateTo(...)\`
- \`shape.orient(axis): SDF3\`, rotates the shape from \`UP\` to the target axis
- \`shape.circular_array(count, offset = 0): SDF\`, alias \`shape.circularArray(...)\`
- \`shape.elongate(size): SDF\`
- \`shape.twist(k): SDF3\`
- \`shape.bend(k): SDF3\`
- \`shape.bend_linear(p0, p1, vector, ease = ease.linear): SDF3\`, alias \`shape.bendLinear(...)\`
- \`shape.bend_radial(r0, r1, dz, ease = ease.linear): SDF3\`, alias \`shape.bendRadial(...)\`
- \`transition_linear(a, b, p0 = -Z, p1 = Z, ease = ease.linear): SDF3\`, method alias \`shape.transitionLinear(...)\`
- \`transition_radial(a, b, r0 = 0, r1 = 1, ease = ease.linear): SDF3\`, method alias \`shape.transitionRadial(...)\`
- \`shape.wrap_around(x0, x1, radius = auto, ease = ease.linear): SDF3\`, alias \`shape.wrapAround(...)\`

### 2D To 3D

- \`shape.slice(): SDF2\`
- \`shape.extrude(height): SDF3\`
- \`extrude_to(a, b, height, ease = ease.linear): SDF3\`, method alias \`shape.extrudeTo(...)\`
- \`shape.revolve(offset = 0): SDF3\`

### Constants And Math Helpers

- Constants: \`PI\`, \`ORIGIN\`, \`ORIGIN2\`, \`X\`, \`Y\`, \`Z\`, \`UP\`, \`X2\`, \`Y2\`, \`UP2\`
- Helpers: \`radians\`, \`degrees\`, \`add\`, \`sub\`, \`mul\`, \`div\`, \`normalize\`, \`cross\`, \`dot\`, \`length\`, \`mix\`, \`clamp\`, \`modulo\`
- Easing namespace: \`ease.linear\`, plus named easing functions for bends, transitions, extrusions, and wraps

### Workflow Globals

\`generate\`, \`save\`, \`save3mf\`, \`sample_slice\`, and \`show_slice\` are available for manual workflows, but browser session edits should return an \`SDF3\` for the renderer.

- \`generate(sdf, options = {}): Promise<MeshResult>\`
- \`save(filename, sdf, options = {}): Promise<Blob>\`; use \`.stl\` filenames
- \`save3mf(filename, sdf, options = {}): Promise<{ blob, report }>\`; use \`.3mf\` filenames
- \`sample_slice(sdf, options = {}): SliceSample\`
- \`show_slice(sdf, options = {}): HTMLCanvasElement\`

\`save3mf\` packages the generated mesh as a colored 3MF. It uses \`.color(...)\` annotations by default, or \`colorsByName\` when you want source names to pick export colors.

\`\`\`js
const left = sphere(0.7).translate([-0.55, 0, 0]).name("left");
const right = sphere(0.7).translate([0.55, 0, 0]).name("right");
const shape = union(left, right);

void save3mf("two-color.3mf", shape, {
  grid: 96,
  colorsByName: {
    left: "#ef4444",
    right: "#22c55e",
  },
}).then(({ report }) => console.log(report.colors));

return shape;
\`\`\`

Once Mesh view has generated triangles, the viewport download controls can export either STL or 3MF for the visible model.

## Browser Session API Reference

### GET /status

Returns the active browser tab state, app health, and the snapshot list. If no tab is connected, the response still includes session metadata and persisted snapshots.

\`\`\`sh
curl -s "$BASE/status"
\`\`\`

Response fields include:

- \`connected\`: whether a browser tab is currently attached
- \`app.sourceValid\`: whether the current editor source compiled
- \`app.status\`: the editor status text
- \`app.viewMode\`: currently expected to be \`shader\` for agent screenshots
- \`snapshots\`: persisted snapshot metadata

### GET /code

Returns the current editor source as plain text.

\`\`\`sh
curl -s "$BASE/code" > current-sdf.js
\`\`\`

### PUT /code

Replaces the editor source in the active browser tab, compiles it, switches to the shader view, captures a PNG screenshot, writes a code snapshot, and returns snapshot metadata.

JSON body:

\`\`\`json
{
  "comment": "Explaining why this code change is useful to check.",
  "code": "return sphere(1);"
}
\`\`\`

\`\`\`sh
curl -sS -X PUT "$BASE/code" \\
  -H 'content-type: application/json' \\
  --data-binary @update.json
\`\`\`

Plain-text bodies are also accepted. Put the comment in either \`?comment=\` or \`X-SDF-Comment\`.

\`\`\`sh
curl -sS -X PUT "$BASE/code?comment=Trying%20a%20smaller%20outer%20radius" \\
  -H 'content-type: text/plain' \\
  --data-binary @current-sdf.js
\`\`\`

Response fields:

- \`sourceValid\`: whether the new code compiled
- \`status\`: editor status text after compile
- \`snapshot.codeUrl\`: URL for the saved source
- \`snapshot.screenshotUrl\`: URL for the saved shader PNG

Failed code still creates a snapshot when the browser can respond, so the collaboration trail includes broken attempts.

### GET /screenshot.png

Switches the active tab to shader view, captures the current shader canvas, writes a screenshot snapshot, and returns PNG bytes.

\`\`\`sh
curl -s "$BASE/screenshot.png?comment=Checking%20whether%20the%20profile%20is%20legible" -o screenshot.png
\`\`\`

Useful response headers:

- \`X-SDF-Snapshot-Id\`
- \`X-SDF-Snapshot-Url\`

### GET /snapshots

Lists snapshots persisted under this session.

\`\`\`sh
curl -s "$BASE/snapshots"
\`\`\`

Each snapshot may include:

- \`id\`
- \`kind\`: \`code\`, \`screenshot\`, \`manual\`, or \`undo\`
- \`comment\`
- \`sourceValid\`
- \`status\`
- \`codeUrl\`
- \`screenshotUrl\`
- \`restoredSnapshotId\`

### POST /snapshots

Creates a snapshot. If called from outside the browser with only a comment, the server asks the active tab to capture the current shader state. The browser UI uses this same endpoint for the Snapshot button.

\`\`\`sh
curl -sS -X POST "$BASE/snapshots" \\
  -H 'content-type: application/json' \\
  -d '{"comment":"Saving the current baseline before trying a thinner wall."}'
\`\`\`

### GET /snapshots/:snapshotId/code.js

Returns the source saved for a snapshot.

\`\`\`sh
curl -s "$BASE/snapshots/000002/code.js"
\`\`\`

### GET /snapshots/:snapshotId/screenshot.png

Returns the PNG saved for a snapshot.

\`\`\`sh
curl -s "$BASE/snapshots/000002/screenshot.png" -o snapshot-000002.png
\`\`\`

### POST /snapshots/:snapshotId/restore

Restores code from one specific snapshot into the active browser tab, compiles it, captures a shader screenshot, and writes a new append-only \`restore\` snapshot. The original snapshot remains untouched.

\`\`\`sh
curl -sS -X POST "$BASE/snapshots/000002/restore" \\
  -H 'content-type: application/json' \\
  -d '{"comment":"Restoring the wider base as the latest version."}'
\`\`\`

Response fields include:

- \`restoredSnapshot\`: the older snapshot that supplied the code
- \`snapshot\`: the newly created latest snapshot
- \`snapshot.restoredSnapshotId\`: the source snapshot id

### POST /undo

Restores only the editor code from the most recent snapshot whose code differs from the current editor contents. It then compiles, captures a shader screenshot, and writes an \`undo\` snapshot.

\`\`\`sh
curl -sS -X POST "$BASE/undo" \\
  -H 'content-type: application/json' \\
  -d '{"comment":"Returning to the last readable silhouette before changing the cutouts."}'
\`\`\`

## Snapshot Storage

Snapshots are stored on disk in this repo under:

\`\`\`text
.sessions/${sessionId}/
  session.json
  snapshots/
    000001/
      meta.json
      code.js
      screenshot.png
\`\`\`

The \`.sessions/\` directory is local-only and ignored by git.

## Project API

Projects are the user-facing view of local browser sessions. A project id is currently the same value as its session id, so existing \`/s/${sessionId}\` links and \`/api/sessions/${sessionId}\` commands keep working.

### GET /api/projects

Lists local projects with names, app URLs, API URLs, connection state, snapshot counts, and latest screenshot URLs.

\`\`\`sh
curl -s "$PROJECTS"
\`\`\`

### POST /api/projects

Creates a new local project/session and returns its app URL.

\`\`\`sh
curl -sS -X POST "$PROJECTS" \\
  -H 'content-type: application/json' \\
  -d '{"name":"Bracket study"}'
\`\`\`

### PATCH /api/projects/:projectId

Renames a project without changing its session id or snapshots.

\`\`\`sh
curl -sS -X PATCH "$PROJECTS/${sessionId}" \\
  -H 'content-type: application/json' \\
  -d '{"name":"Bracket study v2"}'
\`\`\`

## Internal Browser Transport

The browser tab connects to \`GET /events\` with Server-Sent Events and posts command results back to \`POST /results/:commandId\`. Agents usually should not call those endpoints directly.
`;
}
