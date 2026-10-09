import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: {
      strict: false,
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    server: {
      deps: {
        external: [/\/test-tmp\/[^/]+\/app\.mjs(?:\?|$)/, /\/kumiki-smoke-[^/]+\/app\.mjs(?:\?|$)/],
      },
    },
  },
});
