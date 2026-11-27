import { GUIDES, readGuide } from "@kumikijs/cli";
import { describe, expect, it } from "vitest";
import { callOnce } from "./helpers/client.ts";

describe("kumiki_guide", () => {
  it.each([
    ...GUIDES.map((g) => g.name),
    "E0201",
    "language",
  ])("answers %s with what `kumiki guide` prints", async (topic) => {
    const got = await callOnce("kumiki_guide", { topic });
    expect(got.isError).toBe(false);
    expect(got.body).toBe(readGuide(topic)?.text);
  });

  it("lists the topics when given none", async () => {
    const got = await callOnce("kumiki_guide", {});
    expect(got.isError).toBe(false);
    for (const g of GUIDES) expect(got.body).toContain(g.name);
  });

  it("flags a topic it does not have", async () => {
    const got = await callOnce("kumiki_guide", { topic: "nonsense" });
    expect(got.isError).toBe(true);
    expect(got.body).toContain('no guide for \\"nonsense\\"');
  });
});

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
