import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Relative base so the production build opens from a local file path
// (file://) with no server. See PRODUCT plan sections 8.4-8.5.
export default defineConfig({
  base: "./",
  plugins: [svelte()],
  build: {
    target: "es2022",
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node"
  }
});
