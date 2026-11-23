import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Keep the production bootstrap conventional: Vite emits versioned, same-origin
// JS/CSS assets instead of embedding the entire application in index.html.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
