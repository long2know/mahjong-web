import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  build: { modulePreload: { polyfill: false } },
  server: mode === "geometry" ? { hmr: false, watch: null } : undefined,
}));
