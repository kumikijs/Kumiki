import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    // Most tests here are pure compiler calls and finish in milliseconds. The
    // few that write the generated module to disk and `import()` it pay for a
    // real module load, which on a cold cache overruns the 5s default with
    // nothing wrong — a timeout in this suite has never been a real failure.
    testTimeout: 30_000,
  },
});
