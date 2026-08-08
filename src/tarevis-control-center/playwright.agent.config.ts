import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "agent-workspace.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5180",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev --prefix backend",
      url: "http://127.0.0.1:8780/api/health",
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        CONTROL_CENTER_MODE: "mock",
        CONTROL_CENTER_HOST: "127.0.0.1",
        CONTROL_CENTER_PORT: "8780",
      },
    },
    {
      command: "npm run dev -- --port 5180",
      url: "http://127.0.0.1:5180",
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        VITE_CONTROL_CENTER_ADAPTER: "live",
        VITE_CONTROL_CENTER_API_BASE: "/",
        VITE_CONTROL_CENTER_AUTH_MODE: "mock",
        VITE_CONTROL_CENTER_DEVICE_ID: "my-computer",
        CONTROL_CENTER_PROXY_TARGET: "http://127.0.0.1:8780",
      },
    },
  ],
  projects: [
    {
      name: "chromium-agent",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
