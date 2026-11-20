import { defineConfig, devices } from "@playwright/test";

const adminUrl = process.env.RDPS_BROWSER_ADMIN_URL ?? "http://127.0.0.1:4173";
const publicUrl = "http://127.0.0.1:4174";
const adminPort = new URL(adminUrl).port || "4173";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : "list",
  outputDir: "test-results",
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: `pnpm --filter @rdps/admin-web dev --host 127.0.0.1 --port ${adminPort} --strictPort`,
      url: adminUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_BASE_URL: "http://127.0.0.1:13001/api/v1" },
    },
    {
      command:
        "pnpm --filter @rdps/public-web dev --host 127.0.0.1 --port 4174 --strictPort",
      url: publicUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_BASE_URL: "http://127.0.0.1:13001/api/v1/public" },
    },
  ],
});
