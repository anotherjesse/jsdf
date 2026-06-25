# sdf browser

`sdf browser` is a browser-native signed distance field playground and modeling tool. You write small JavaScript snippets that build 2D and 3D SDF graphs, preview them instantly in WebGL, inspect the generated graph, and export meshes when you want triangles.

The project is a root-level npm/Vite app with a small static shell in [`static/`](static/) and TypeScript implementation modules in [`src/`](src/):

- A Monaco-based SDF editor with source links into the graph
- A JavaScript SDF API for primitives, CSG, transforms, deformations, extrusion, and revolve
- GLSL raymarch preview for fast visual feedback
- Mesh generation with surface-net and marching-tetra extraction paths
- STL export from the generated mesh
- A local browser-session API so agents or scripts can update code, capture screenshots, and save snapshots through the live tab

For a visual JavaScript API reference, see [`docs/API.md`](docs/API.md). For a deeper system map, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Quick Start

```sh
npm install
npm run dev
```

The dev server listens on `http://127.0.0.1:5173/` by default. Open that URL to start a new browser SDF session.

You can override the host or port:

```sh
HOST=0.0.0.0 PORT=4173 npm run dev
```

## Writing SDFs

Editor code is plain JavaScript with the SDF API already in scope. Return an `SDF3`, or leave a final expression that evaluates to one.

```js
const ring = torus(0.72, 0.08);
const post = capped_cylinder([0, 0, -0.7], [0, 0, 0.7], 0.16);
const cap = sphere(0.32).translate([0, 0, 0.82]);

return union(ring, post, cap, { k: 0.05 });
```

Useful globals include:

- 3D primitives: `sphere`, `box`, `rounded_box`, `torus`, `capsule`, `cylinder`, `capped_cylinder`, `capped_cone`, `ellipsoid`, `pyramid`, and the polyhedra helpers
- 2D primitives: `circle`, `rectangle`, `polygon`, `hexagon`, and related shapes
- CSG: `union`, `difference`, `intersection`, `blend`, `shell`, `dilate`, `erode`
- Transforms: `translate`, `scale`, `rotate`, `orient`, `circular_array`, `twist`, `bend_linear`, `bend_radial`, `wrap_around`
- 2D to 3D: `extrude`, `extrude_to`, `revolve`
- Math helpers and constants: `PI`, `X`, `Y`, `Z`, `UP`, `radians`, `degrees`, `add`, `sub`, `mul`, `normalize`

The full browser API guide in [`docs/API.md`](docs/API.md) follows the original Python documentation style, with rendered thumbnails, signatures, and JavaScript snippets. The live session connection guide also includes a compact API summary:

```sh
curl -s http://127.0.0.1:5173/api/sessions/<session-id>/connect.md
```

## Browser Sessions

Every app URL under `/s/<session-id>` has a matching local API under `/api/sessions/<session-id>`. The browser tab remains the renderer; the API sends commands to that active tab and records snapshots under `.sessions/`.

Common commands:

```sh
BASE="http://127.0.0.1:5173/api/sessions/<session-id>"

curl -s "$BASE/status"
curl -s "$BASE/code" > current-sdf.js
curl -s "$BASE/screenshot.png?comment=Checking%20the%20shape" -o screenshot.png
curl -s "$BASE/snapshots"
```

Update the live editor and capture a snapshot:

```sh
cat > update.json <<'JSON'
{
  "comment": "Trying a rounded bracket profile.",
  "code": "return rounded_box([1.8, 0.8, 0.35], 0.12);"
}
JSON

curl -sS -X PUT "$BASE/code" \
  -H 'content-type: application/json' \
  --data-binary @update.json
```

Fetch the generated connection guide for the exact session:

```sh
curl -s "$BASE/connect.md"
```

## Project Layout

- [`docs/API.md`](docs/API.md) is the visual JavaScript API reference.
- [`static/`](static/) contains the app HTML shell, verifier pages, and shared CSS served by Vite.
- [`src/api/`](src/api/) defines the browser SDF API surface.
- [`src/core/`](src/core/) contains graph nodes, math helpers, and easing utilities.
- [`src/evaluate/`](src/evaluate/) contains CPU reference evaluators.
- [`src/glsl/`](src/glsl/) compiles SDF graphs for the raymarch preview.
- [`src/wgsl/`](src/wgsl/) contains the WebGPU-oriented compiler path.
- [`src/gpu/`](src/gpu/) handles WebGPU sampling support when available.
- [`src/mesh/`](src/mesh/) handles bounds, polygonization, and STL output.
- [`src/preview/`](src/preview/) renders shader and mesh previews.
- [`src/editor/`](src/editor/) owns the editor, graph integration, diagnostics, and browser-session client.
- [`src/workflow.ts`](src/workflow.ts) exposes `generate`, `save`, `sample_slice`, and `show_slice` helpers for browser workflows.
- [`session-server.mjs`](session-server.mjs) serves the app and exposes the local session API.
- [`server/`](server/) contains Node-only helpers for Vite/static serving and the generated session connection guide.
- [`vite.config.ts`](vite.config.ts) uses `static/` as the Vite root and aliases `/src` to the TypeScript source tree.

## Checks

The app includes TypeScript checking and browser verifier pages.

```sh
npm run check
```

`npm run check` runs the TypeScript check, the live browser verifier, and the production Vite build. The individual commands are also available when you want a narrower loop:

```sh
npm test
npm run verify:live
npm run build
```

`npm run verify:live` requires Node 22 or newer. It starts a temporary Vite server, launches headless Chrome or Chromium, visits every focused verifier page, and fails if any page reports an error. Set `CHROME_PATH=/path/to/chrome` if Chrome is not installed in a standard location.

Verifier pages are also available manually while the dev server is running:

- `http://127.0.0.1:5173/checks.html`
- `http://127.0.0.1:5173/api-check.html`
- `http://127.0.0.1:5173/app-health-check.html`
- `http://127.0.0.1:5173/editor-check.html`
- `http://127.0.0.1:5173/graph-check.html`
- `http://127.0.0.1:5173/mesh-check.html`
- `http://127.0.0.1:5173/preview-check.html`
- `http://127.0.0.1:5173/examples-visual-check.html`

## Attribution

This repository is derived from Michael Fogleman's original [`sdf`](https://github.com/fogleman/sdf) project and keeps the same MIT License. See [`NOTICE.md`](NOTICE.md) and [`LICENSE.md`](LICENSE.md). The original Python implementation is no longer vendored here; this repository now focuses on the browser-native JavaScript editor and session workflow described above.
