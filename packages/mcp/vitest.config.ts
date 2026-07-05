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
  },
});
