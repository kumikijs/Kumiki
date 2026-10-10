import { defineConfig } from "vitest/config";
import { sharedTestOptions } from "../../vitest.shared.ts";

export default defineConfig({
  test: {
    environment: "node",
    ...sharedTestOptions,
  },
});
