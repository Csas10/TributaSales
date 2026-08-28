import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.html",
      preserveEntrySignatures: "allow-extension",
    },
  },
  css: {
    // no special config needed
  },
});
