import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: {
      // Allow Vitest to serve generated bundles dropped into test-tmp/.
      strict: false,
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["test/**/*.test.ts"],
    // Nearly every test here compiles a `.kumiki` file and inlines the runtime
    // bundle before it can assert anything, and some then drive the app through
    // a settle window. That is seconds of real work against vitest's 5s
    // default, so a cold cache or a loaded machine turns into a spurious
    // timeout. Same reasoning, same number, as packages/tests.
    testTimeout: 30000,
  },
});
