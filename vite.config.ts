import { resolve } from "node:path";
import { defineConfig } from "vite";

const appRoot = __dirname;
const staticRoot = resolve(appRoot, "static");
const sourceRoot = resolve(appRoot, "src");
const fsDeny = [".env", ".env.*", "*.{crt,pem}", "**/.git/**", ".sessions", "**/.sessions/**"];

export default defineConfig({
  root: staticRoot,
  base: process.env.GITHUB_ACTIONS ? "/jsdf/" : "/",
  resolve: {
    alias: {
      "/src": sourceRoot,
    },
  },
  server: {
    allowedHosts: true,
    fs: {
      allow: [appRoot],
      deny: fsDeny,
    },
  },
  build: {
    outDir: resolve(appRoot, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        apiCheck: resolve(staticRoot, "api-check.html"),
        appHealthCheck: resolve(staticRoot, "app-health-check.html"),
        checks: resolve(staticRoot, "checks.html"),
        editorCheck: resolve(staticRoot, "editor-check.html"),
        examplesVisualCheck: resolve(staticRoot, "examples-visual-check.html"),
        graphCheck: resolve(staticRoot, "graph-check.html"),
        main: resolve(staticRoot, "index.html"),
        meshCheck: resolve(staticRoot, "mesh-check.html"),
        previewCheck: resolve(staticRoot, "preview-check.html"),
        raymarchHello: resolve(staticRoot, "raymarch-hello.html"),
      },
    },
  },
});
