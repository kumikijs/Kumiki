import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["test/**/*.test.ts"],
    // A fixed, non-zero offset. `Time.format` renders local fields, and at
    // offset 0 every `getUTC*` twin produces identical output — so on a UTC
    // runner the local-vs-UTC guarantee is unenforceable and the test that
    // checks it skips itself. Pinned west of Greenwich so a date-only string
    // read as UTC midnight lands on the previous local day, which is the case
    // that broke.
    env: { TZ: "America/Los_Angeles" },
  },
});
