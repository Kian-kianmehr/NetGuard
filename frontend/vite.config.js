import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Keep the production entry as a normal same-origin asset. This avoids inline
// script/CSP conflicts and lets the browser report entry-load failures.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
