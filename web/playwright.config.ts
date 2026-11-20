import { defineConfig } from "@playwright/test";

const geometryPort = Number(process.env.MAHJONG_GEOMETRY_PORT ?? 4179);
if (!Number.isInteger(geometryPort) || geometryPort < 1024 || geometryPort > 65535) {
  throw new Error("MAHJONG_GEOMETRY_PORT must be a non-privileged TCP port.");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  reporter: "line",
  timeout: 60000,
  expect: { timeout: 8500 },
  workers: 2,
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:8080",
    viewport: { width: 390, height: 780 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: `npm run dev -- --mode geometry --port ${geometryPort} --strictPort`,
    url: `http://127.0.0.1:${geometryPort}/e2e/fixtures/geometry.html`,
    reuseExistingServer: false,
  },
});
