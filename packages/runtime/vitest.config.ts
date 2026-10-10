import { defineConfig } from "vitest/config";
import { sharedTestOptions } from "../../vitest.shared.ts";

export default defineConfig({
  test: {
    environment: "happy-dom",
    ...sharedTestOptions,
    // Non-zero and west of UTC, so a date-only string misread as UTC midnight shows up as the
    // previous local day.
    env: { TZ: "America/Los_Angeles" },
  },
});
