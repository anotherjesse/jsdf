import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/jsdf/" : "/",
  build: {
    rollupOptions: {
      input: {
        apiCheck: resolve(__dirname, "api-check.html"),
        editorCheck: resolve(__dirname, "editor-check.html"),
        graphCheck: resolve(__dirname, "graph-check.html"),
        main: resolve(__dirname, "index.html"),
        meshCheck: resolve(__dirname, "mesh-check.html"),
        previewCheck: resolve(__dirname, "preview-check.html"),
        raymarchHello: resolve(__dirname, "raymarch-hello.html"),
      },
    },
  },
});
