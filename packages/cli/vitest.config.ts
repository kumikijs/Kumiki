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
    testTimeout: 30000,
    unstubEnvs: true,
    server: {
      deps: {
        external: [/\/test-tmp\/[^/]+\/app\.mjs(?:\?|$)/, /\/kumiki-smoke-[^/]+\/app\.mjs(?:\?|$)/],
      },
    },
  },
});
