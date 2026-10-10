import { defineConfig } from "vitest/config";
import { sharedTestOptions } from "../../vitest.shared.ts";

export default defineConfig({
  server: {
    fs: {
      strict: false,
    },
  },
  test: {
    environment: "happy-dom",
    ...sharedTestOptions,
  },
});
