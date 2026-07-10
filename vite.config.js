import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works at any mount point,
  // including GitHub Pages' /speed-read/ subpath.
  base: "./",
});
