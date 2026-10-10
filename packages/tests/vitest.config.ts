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
    env: { TZ: "America/Los_Angeles" },
  },
});
