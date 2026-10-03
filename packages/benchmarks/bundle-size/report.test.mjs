import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  compareReports,
  formatDelta,
  MARKER,
  renderComparison,
  renderReport,
  sizes,
} from "./report.mjs";

/** One app's row with every metric at `n`, so a test changes only what it names. */
function app(name, n, overrides = {}) {
  return {
    name,
    bundle: { raw: n, gzip: n, brotli: n },
    modular: { files: 3, raw: n, gzip: n, brotli: n },
    runtime: n,
    ...overrides,
  };
}

describe("sizes", () => {
  it("counts bytes, not characters", () => {
    // Three characters, nine UTF-8 bytes: what a server sends is bytes.
    expect(sizes(Buffer.from("組木組")).raw).toBe(9);
  });

  it("compresses at gzip level 9, the level a precompressed deploy ships", () => {
    const buf = Buffer.from("const a = 1;\n".repeat(200));
    expect(sizes(buf).gzip).toBe(gzipSync(buf, { level: 9 }).length);
  });

  it("reports brotli below gzip on repetitive source", () => {
    const s = sizes(Buffer.from("export function f(x) { return x + 1; }\n".repeat(500)));
    expect(s.brotli).toBeLessThan(s.gzip);
    expect(s.gzip).toBeLessThan(s.raw);
  });
});

describe("formatDelta", () => {
  it("says ±0 for no change, so a reader can scan for the rows that moved", () => {
    expect(formatDelta(20_129, 20_129)).toBe("±0");
  });

  it("signs a growth and gives the share of the base", () => {
    expect(formatDelta(20_000, 20_346)).toBe("+346 (+1.7%)");
  });

  it("signs a shrink", () => {
    expect(formatDelta(20_000, 19_880)).toBe("-120 (-0.6%)");
  });

  it("separates thousands", () => {
    expect(formatDelta(10_000, 12_500)).toBe("+2,500 (+25.0%)");
  });

  it("gives no percentage against a zero base, where a share has no meaning", () => {
    expect(formatDelta(0, 512)).toBe("+512");
  });
});

describe("compareReports", () => {
  it("marks an app whose bytes moved as changed, and one that did not as unchanged", () => {
    const base = { apps: [app("a", 100), app("b", 100)] };
    const head = {
      apps: [app("a", 100), app("b", 100, { bundle: { raw: 100, gzip: 90, brotli: 100 } })],
    };
    const { rows } = compareReports(base, head);
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ["a", "unchanged"],
      ["b", "changed"],
    ]);
  });

  it("names an app only the head builds as added, and one only the base builds as removed", () => {
    const { rows } = compareReports({ apps: [app("old", 1)] }, { apps: [app("new", 1)] });
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ["new", "added"],
      ["old", "removed"],
    ]);
  });

  it("totals only the apps both sides build, so adding an example is not a regression", () => {
    const base = { apps: [app("a", 100)] };
    const head = { apps: [app("a", 110), app("new", 5_000)] };
    const { total } = compareReports(base, head);
    expect(total.base.bundle.gzip).toBe(100);
    expect(total.head.bundle.gzip).toBe(110);
  });

  it("keeps an app only the base builds out of the total too, so removing one is not a win", () => {
    const base = { apps: [app("a", 100), app("old", 5_000)] };
    const head = { apps: [app("a", 110)] };
    const { total } = compareReports(base, head);
    expect(total.base.bundle.gzip).toBe(100);
    expect(total.head.bundle.gzip).toBe(110);
  });
});

describe("renderReport", () => {
  it("prints one row per app with every metric of a single run, in report order", () => {
    const md = renderReport({
      apps: [
        {
          name: "01-counter",
          bundle: { raw: 60_782, gzip: 20_129, brotli: 18_191 },
          modular: { files: 7, raw: 66_691, gzip: 24_132, brotli: 21_830 },
          runtime: 63_331,
        },
        app("02-todomvc", 1),
      ],
    });
    const rows = md.split("\n").filter((l) => l.startsWith("| 0"));
    expect(rows).toEqual([
      "| 01-counter | 60,782 | 20,129 | 18,191 | 7 | 24,132 | 63,331 |",
      "| 02-todomvc | 1 | 1 | 1 | 3 | 1 | 1 |",
    ]);
  });
});

describe("renderComparison", () => {
  it("opens with the marker the CI step finds its own comment by", () => {
    const md = renderComparison({ apps: [app("a", 1)] }, { apps: [app("a", 1)] });
    expect(md.startsWith(MARKER)).toBe(true);
  });

  it("says nothing moved when no app's bytes did", () => {
    const md = renderComparison({ apps: [app("a", 1)] }, { apps: [app("a", 1)] });
    expect(md).toContain("No change");
  });

  it("puts the head value and its delta in each changed cell", () => {
    const base = { apps: [app("01-counter", 20_000)] };
    const head = {
      apps: [app("01-counter", 20_000, { bundle: { raw: 20_000, gzip: 20_346, brotli: 20_000 } })],
    };
    const md = renderComparison(base, head);
    expect(md).toContain("01-counter");
    expect(md).toContain("20,346<br><sub>+346 (+1.7%)</sub>");
    expect(md).not.toContain("No change");
  });

  it("lists added and removed apps instead of diffing them against nothing", () => {
    const md = renderComparison({ apps: [app("old", 1)] }, { apps: [app("new", 1)] });
    expect(md).toMatch(/new.*added/);
    expect(md).toMatch(/old.*removed/);
  });
});
