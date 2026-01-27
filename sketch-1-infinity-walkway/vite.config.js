import { defineConfig } from "vite";

export default defineConfig({
  // IMPORTANT: this must match your GitHub Pages URL path
  base: "/web-based-sketches/sketch-1-infinity-walkway/",
  build: {
    // Output directly into the repo's docs folder for Pages
    outDir: "../docs/sketch-1-infinity-walkway",
    emptyOutDir: true,
  },
});
