import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build works from a sub-path (GitHub Pages, etc.).
  base: "./",
  build: {
    target: "es2020",
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 800,
  },
});
