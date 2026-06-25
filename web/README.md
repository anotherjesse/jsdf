# sdf browser

Browser-native TypeScript implementation inspired by the original Python `sdf` API surface. The active public API is JavaScript; see the visual reference in [`../docs/API.md`](../docs/API.md). The browser implementation intentionally excludes native/Python-heavy APIs:

- `text`, `image`, `measure_text`, `measure_image`
- mesh loading and mesh-as-SDF (`Mesh.from_file`, `Mesh.sdf`)

The browser package is split by responsibility:

- `src/core`: math, easing, and AST node classes
- `src/api`: 2D/3D primitive builders and API completeness fixtures
- `src/evaluate`: CPU reference evaluators
- `src/wgsl`: WGSL code generation for SDF evaluation
- `src/gpu`: WebGPU compute sampling and experimental WGSL renderer
- `src/glsl`: GLSL code generation for shader previews
- `src/mesh`: bounds, polygonization, and STL export
- `src/preview`: WebGL raymarch and mesh preview renderers
- `src/workflow.ts`: `generate`, `save`, `sample_slice`, and `show_slice` helpers for browser workflows

## Run

```bash
cd web
npm install
npm run dev -- --port 4173
```

Open `http://127.0.0.1:4173/`.

Open `http://127.0.0.1:4173/checks.html` for a dashboard of focused browser verifiers.

Open `http://127.0.0.1:4173/api-check.html` to run the browser API verifier. It exercises the completeness fixtures through CPU evaluation plus GLSL and WGSL code generation, and verifies the browser workflow helpers for mesh generation, STL Blob export, and SDF slice rendering.

Open `http://127.0.0.1:4173/app-health-check.html` to run the app health verifier. It loads the editor app in a same-origin frame and checks the non-destructive `window.__sdfAppHealth()` diagnostics for editor readiness, toolbar wiring, source links, preview mode, and Monaco decoration warnings.

Open `http://127.0.0.1:4173/mesh-check.html` to run the browser mesh verifier. It builds surface-net and tetra meshes through the worker path and validates binary STL output.

Open `http://127.0.0.1:4173/preview-check.html` to run the browser preview verifier. It renders both the GLSL raymarch preview and the WebGL mesh preview, then validates nonblank canvas diagnostics.

## Notes

The default visible preview compiles the SDF graph to GLSL and raymarches it directly in WebGL2. Clicking Mesh builds the STL surface on demand and switches to a WebGL preview of the generated triangles; the download icon then exports those same triangles. Shader and Mesh share one orbit camera, so rotation and zoom carry across views. WebGPU is used to sample SDF volumes for STL export when available, with a CPU sampler fallback. Polygonization runs in a Web Worker when available, so high grid sizes do not monopolize the UI thread. Mesh style can switch between surface nets, which places one vertex per active cell by averaging SDF edge zero-crossings, and the earlier marching tetrahedra extractor.
