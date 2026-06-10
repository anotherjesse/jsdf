# sdf browser

Browser-native TypeScript port of the Python `sdf` API surface, excluding the intentionally native/Python-heavy APIs:

- `text`, `image`, `measure_text`, `measure_image`
- mesh loading and mesh-as-SDF (`Mesh.from_file`, `Mesh.sdf`)

The browser package is split by responsibility:

- `src/core`: math, easing, and AST node classes
- `src/api`: 2D/3D primitive builders and API completeness fixtures
- `src/evaluate`: CPU reference evaluators
- `src/wgsl`: WGSL code generation for SDF evaluation
- `src/gpu`: WebGPU compute sampling and experimental raymarch renderer
- `src/mesh`: bounds, polygonization, and STL export
- `src/preview`: WebGL mesh preview renderer

## Run

```bash
cd web
npm install
npm run dev -- --port 4173
```

Open `http://127.0.0.1:4173/`.

## Notes

The visible preview uses WebGL2 to render a preview mesh. WebGPU is used to sample SDF volumes for preview and STL export when available, with a CPU sampler fallback. The current polygonizer is TypeScript marching tetrahedra over the sampled field; it is isolated in `src/mesh/polygonize.ts` so a fully GPU-compacted marching-cubes pass can replace it later without changing the public API.
