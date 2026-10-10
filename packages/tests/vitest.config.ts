import { defineConfig } from "vitest/config";
import { sharedTestOptions } from "../../vitest.shared.ts";

export default defineConfig({
  server: {
    fs: { strict: false },
  },
  test: {
    environment: "happy-dom",
    ...sharedTestOptions,
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/helpers/setup.ts"],
    server: { deps: { external: [/\/\.smoke-tmp\/[^/]+\/app\.mjs(?:\?|$)/] } },
    // Non-zero and west of UTC, so a date-only string misread as UTC midnight shows up as the
    // previous local day.
    env: { TZ: "America/Los_Angeles" },
  },
});
