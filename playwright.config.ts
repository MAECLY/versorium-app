import { defineConfig, devices } from "@playwright/test";

// Browser E2E against the Vite dev server with the Tauri IPC mocked
// (tests/e2e/mock-tauri.ts). Uses the system Chrome so nothing is downloaded.
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
