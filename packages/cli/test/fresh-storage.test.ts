// Each smoke or scenario run is one app's first visit, even when a process
// drives many of them (the corpus suites, the MCP server): the DOM is
// registered once, so its storage has to be emptied per run, or an app that
// restores a key an earlier app wrote boots on that app's value.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ensureDom, smokeFile } from "../src/smoke.ts";

const here = dirname(fileURLToPath(import.meta.url));
const BLOG = join(here, "..", "..", "examples", "apps", "03-blog", "app.kumiki");

describe("a smoke run starts from empty storage", () => {
  it("does not restore a value another app left under the same key", async () => {
    await ensureDom();
    // What `features/119-effect-payload-bind-types` saves under `session`: a
    // shape the blog's `Option(Session)` refuses at `.Some.userId`.
    localStorage.setItem("session", JSON.stringify({ email: "a@example.com" }));
    sessionStorage.setItem("leftover", "1");

    const report = await smokeFile(BLOG);

    expect(report.issues.map((i) => i.message)).toEqual([]);
    expect(sessionStorage.getItem("leftover")).toBeNull();
  }, 30_000);
});
