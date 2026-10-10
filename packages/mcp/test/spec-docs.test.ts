import { describe, expect, it } from "vitest";
import { callOnce } from "./helpers/client.ts";

describe("kumiki_spec_get", () => {
  it("returns a document by bare name and flags a name that matches none", async () => {
    const hit = await callOnce("kumiki_spec_get", { doc: "language" });
    expect(hit.isError).toBe(false);
    expect(hit.body.length).toBeGreaterThan(0);
    const miss = await callOnce("kumiki_spec_get", { doc: "langauge" });
    expect(miss.isError).toBe(true);
    expect(miss.body).toContain('no spec document named \\"langauge\\"');
  });
});
