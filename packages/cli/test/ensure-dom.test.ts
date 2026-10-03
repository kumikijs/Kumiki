// `ensureDom` loads happy-dom on first use, so it is async — and two calls can
// overlap: the MCP server runs `kumiki_smoke` / `kumiki_run_scenario` straight
// out of request handlers without serialising them. happy-dom's registrator
// throws when asked to register twice, so both calls have to share one
// registration rather than each passing a "not yet" check.
//
// A file of its own: the registration is per worker, and any file that has
// already smoked an app would start this one warm.

import { describe, expect, it } from "vitest";
import { ensureDom } from "../src/smoke.ts";

describe("ensureDom", () => {
  it("registers once when two calls overlap", async () => {
    await expect(Promise.all([ensureDom(), ensureDom()])).resolves.toBeDefined();
    // …and a later call finds it done.
    await expect(ensureDom()).resolves.toBeUndefined();
  });
});
