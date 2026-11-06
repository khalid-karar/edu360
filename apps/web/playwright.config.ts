import { defineConfig } from "@playwright/test";

/**
 * Browser tests run the real static export against the real API on an in-memory database (the local sandbox).
 *   npm run build   (web, then api)   then   npm run e2e
 * PW_CHROMIUM may point at an existing Chromium binary; CI installs its own.
 */
export const SECRETS_FILE = "/tmp/ilmak-e2e-secrets.json";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // the sandbox holds state in memory and the tests share its seeded accounts, so they run in order
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4000",
    locale: "ar-SA",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  webServer: [
    {
      command: "node ../api/dist/dev/local.js",
      url: "http://127.0.0.1:3000/api/health",
      env: { DEV_SECRETS_FILE: SECRETS_FILE, PORT: "3000" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    { command: "node e2e/serve.mjs", url: "http://127.0.0.1:4000/portal/login", reuseExistingServer: false, timeout: 30_000 },
  ],
});
