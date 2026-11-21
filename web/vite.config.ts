import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: "./",
  build: { modulePreload: { polyfill: false } },
  server: mode === "geometry" ? { hmr: false, watch: null } : undefined,
}));
