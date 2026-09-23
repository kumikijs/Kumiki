import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    // Allow importing the temp bundles the smoke loader writes under .smoke-tmp/.
    fs: { strict: false },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["**/*.test.ts"],
    // The doubles the headless tiers need but a DOM does not supply — a
    // `fetch` that never leaves the process, and an IntersectionObserver that
    // actually notifies. The CLI installs the same pair in `ensureDom`.
    setupFiles: ["./helpers/setup.ts"],
    // The bundles that loader writes are plain JS with the runtime inlined, so
    // Node imports them as they are. Left to Vite, each one — hundreds of KB,
    // at a fresh path every time — went through its transform pipeline, which
    // was most of this suite's wall time.
    server: { deps: { external: [/\/\.smoke-tmp\//] } },
    // Nearly every test here compiles a `.kumiki` file and inlines the runtime
    // bundle before it can assert anything. That is seconds of real work, and
    // the files run in parallel, so the 5s default turns machine load into
    // spurious failures in whichever file happened to be scheduled last.
    testTimeout: 30000,
  },
});
