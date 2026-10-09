import { feature } from "@kumikijs/examples";
import { type SmokeReport, smoke } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

async function smokeExample(name: string): Promise<SmokeReport> {
  const app = await loadApp(feature(name));
  const report = await withRoot((root) => smoke(app, root, { settleMs: 20 }));
  expect(report.ok).toBe(true);
  return report;
}

const fallbacks = (report: SmokeReport) =>
  report.diagnostics.map((d) => d.diagnostic).filter((d) => d.kind === "reconcile-fallback");

describe("reconcile diagnostics reach the smoke report", () => {
  it("reports the unkeyed sibling rebuild, and never the keyed column beside it", async () => {
    const found = fallbacks(await smokeExample("58-unkeyed-conditional-rebuild"));
    expect(found.map((d) => d.reason)).toContain("child-count-change");
    for (const d of found) {
      expect(d.id).not.toBe("Tags");
      expect(d.tile).not.toBe("Tags");
    }
  });

  it.each([
    "60-empty-state-keyed-list",
    "53-keyed-list-identity",
  ])("reports nothing for the keyed list in %s", async (name) => {
    expect(fallbacks(await smokeExample(name)).map((d) => d.reason)).toEqual([]);
  });

  it("reports the newcomer a one-layer overlay cannot place", async () => {
    const solo = fallbacks(await smokeExample("59-overlay-keyed-layers")).filter(
      (d) => d.tile === "Solo",
    );
    expect(solo.map((d) => d.reason)).toEqual(["unplaceable-insert", "child-count-change"]);
  });
});
