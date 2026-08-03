import { defineConfig, devices } from "@playwright/test";

// Real-browser verification tier — Chromium only. This tier exists to catch
// CSS layout / focus visibility / paint order / real rendering bugs that
// happy-dom (smoke) and the scenario oracle cannot observe by construction.
// Retries are deliberately 0: a flaky green here would mask a paint/focus race
// this tier is the last line of defense against.
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never" }]] : "list",
  use: {
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
