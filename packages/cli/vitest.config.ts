import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: {
      // Allow importing the `kumiki build` output that cli.test.ts and
      // build-minify.test.ts write to the OS temp dir, outside this root.
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
    // The bundles some of these tests import are compiled with `bundle: true`
    // — the runtime inlined, no imports left — and written as `app.mjs` under
    // test-tmp/ (test/helpers/build-and-load.ts) or a kumiki-smoke-* temp dir
    // (`loadApp` in src/smoke.ts). Node imports them as they are; Vite would
    // transform each one afresh. The `kumiki build` output imported from
    // kumiki-cli-* / kumiki-min-* is modular, with `./runtime/*.js` imports, and
    // stays with Vite. Renaming either directory or the file does not fail
    // anything; the tests just get slow again.
    server: {
      deps: {
        external: [/\/test-tmp\/[^/]+\/app\.mjs(?:\?|$)/, /\/kumiki-smoke-[^/]+\/app\.mjs(?:\?|$)/],
      },
    },
  },
});
