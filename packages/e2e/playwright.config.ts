import { defineConfig, devices } from "@playwright/test";

// Real-browser verification tier — Chromium only.
// Firefox / WebKit are non-goals for the initial wire-up (see issue #154);
// this tier exists to catch CSS layout / focus visibility / paint order /
// real rendering bugs that happy-dom (smoke) and the JSDOM-free scenario
// oracle cannot observe by construction.
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
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
