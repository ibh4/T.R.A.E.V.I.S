import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "live-control-center.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5181",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5181",
    url: "http://127.0.0.1:5181",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_CONTROL_CENTER_ADAPTER: "live",
      VITE_CONTROL_CENTER_API_BASE: "/",
      VITE_CONTROL_CENTER_AUTH_MODE: "mock",
      VITE_CONTROL_CENTER_DEVICE_ID: "my-computer",
      CONTROL_CENTER_PROXY_TARGET: "http://127.0.0.1:8781",
    },
  },
  projects: [
    {
      name: "chromium-live",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
