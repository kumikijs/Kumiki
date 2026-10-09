import { defineConfig } from "vitest/config";
import { sharedTestOptions } from "../../vitest.shared.ts";

export default defineConfig({
  test: {
    environment: "happy-dom",
    ...sharedTestOptions,
    env: { TZ: "America/Los_Angeles" },
  },
});
