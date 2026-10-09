import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: { strict: false },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["**/*.test.ts"],
    setupFiles: ["./helpers/setup.ts"],
    server: { deps: { external: [/\/\.smoke-tmp\/[^/]+\/app\.mjs(?:\?|$)/] } },
    testTimeout: 30000,
    env: { TZ: "America/Los_Angeles" },
  },
});
