import { describe, expect, it } from "vitest";
import { isUnstable, median, percentile, stddev, summarize } from "./stats.mjs";

/** `[1, 2, …, n]` — handy for percentile ranks that stay hand-checkable. */
function range(n) {
  return Array.from({ length: n }, (_, i) => i + 1);
}

describe("median", () => {
  it("returns the middle value for an odd-length, unsorted sample", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for an even-length sample", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns the only value for a single-element sample", () => {
    expect(median([7])).toBe(7);
  });

  it("does not reorder the caller's array", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  it("rejects an empty sample", () => {
    expect(() => median([])).toThrow();
  });
});

describe("sample validation", () => {
  // A NaN also makes the sort comparator inconsistent, so silently continuing
  // would produce an arbitrary order rather than a merely wrong number.
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("rejects a sample holding %s", (_label, bad) => {
    const xs = [1, 2, bad, 4];
    expect(() => median(xs)).toThrow(/finite/);
    expect(() => percentile(xs, 0.9)).toThrow(/finite/);
    expect(() => stddev(xs)).toThrow(/finite/);
    expect(() => summarize(xs)).toThrow(/finite/);
  });

  it("names the offending index and value", () => {
    expect(() => median([1, 2, Number.NaN])).toThrow("sample[2] is NaN");
  });
});

describe("percentile", () => {
  it("uses nearest-rank: p90 of 1..10 is the 9th smallest", () => {
    // ceil(0.9 * 10) = 9 → the 9th value of the ascending sample.
    expect(percentile(range(10), 0.9)).toBe(9);
  });

  it("scales to the benchmark's sample size: p90 of 1..200 is the 180th smallest", () => {
    expect(percentile(range(200), 0.9)).toBe(180);
  });

  it("never interpolates — every result is an observed sample", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
  });

  it("returns the maximum at p=1 and the minimum for the smallest rank", () => {
    expect(percentile(range(10), 1)).toBe(10);
    expect(percentile(range(10), 0.01)).toBe(1);
  });

  it("stays in range for a p far below the first rank", () => {
    expect(percentile(range(200), 1e-12)).toBe(1);
  });

  it("returns the only value for a single-element sample at any p", () => {
    expect(percentile([7], 0.9)).toBe(7);
    expect(percentile([7], 1)).toBe(7);
  });

  it("rejects a percentile outside (0, 1]", () => {
    expect(() => percentile(range(10), 0)).toThrow();
    expect(() => percentile(range(10), 1.5)).toThrow();
  });

  it("rejects an empty sample", () => {
    expect(() => percentile([], 0.9)).toThrow();
  });
});

describe("stddev", () => {
  it("is the sample standard deviation (n-1), not the population one", () => {
    // mean 5, squared deviations sum to 32 → sample sqrt(32/7), population 2.
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(stddev(xs)).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(stddev(xs)).not.toBeCloseTo(2, 3);
  });

  it("is zero when every sample is identical", () => {
    expect(stddev([5, 5, 5])).toBe(0);
  });

  it("is zero for a single sample (no spread to estimate)", () => {
    expect(stddev([5])).toBe(0);
  });

  it("does not reorder the caller's array", () => {
    const xs = [3, 1, 2];
    stddev(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  it("does not depend on the order the samples arrived in", () => {
    const xs = Array.from({ length: 200 }, (_, i) => ((i * 7) % 13) / 3);
    expect(stddev([...xs].reverse())).toBe(stddev(xs));
  });

  it("rejects an empty sample", () => {
    expect(() => stddev([])).toThrow();
  });
});

describe("summarize", () => {
  it("reports count/min/max/median/p90/stddev consistently", () => {
    // Ascending: 1 2 3 4 4 5 5 7 9 10. median = (4+5)/2 = 4.5, p90 = ceil(0.9*10) = 9th = 9.
    // mean = 50/10 = 5, squared deviations sum to 76 → sample stddev = sqrt(76/9) ≈ 2.906.
    const xs = [4, 9, 1, 5, 3, 10, 2, 7, 4, 5];
    expect(summarize(xs)).toEqual({
      count: 10,
      min: 1,
      max: 10,
      median: 4.5,
      p90: 9,
      stddev: Math.sqrt(76 / 9),
    });
  });

  it("agrees with the individual helpers", () => {
    const xs = range(200).map((n) => (n * 7) % 13);
    const s = summarize(xs);
    expect(s.median).toBe(median(xs));
    expect(s.p90).toBe(percentile(xs, 0.9));
    expect(s.stddev).toBe(stddev(xs));
    expect(s.min).toBe(Math.min(...xs));
    expect(s.max).toBe(Math.max(...xs));
  });

  it("rejects an empty sample instead of reporting NaN", () => {
    expect(() => summarize([])).toThrow();
  });
});

describe("isUnstable", () => {
  it("is quiet when the tail stays close to the body", () => {
    // A healthy row: p90/median ≈ 1.8.
    expect(isUnstable({ median: 0.178, p90: 0.322 })).toBe(false);
  });

  it("fires when p90 detaches from the median", () => {
    // A row from a run whose median had itself doubled: p90/median ≈ 4.3.
    expect(isUnstable({ median: 0.403, p90: 1.746 })).toBe(true);
  });

  it("ignores an isolated pause that only inflates the stddev", () => {
    // 199 samples at 0.04 ms + one 5 ms GC pause: stddev/median ≈ 9, but the
    // median and p90 are both 0.04 — the run is fine and must not warn.
    const xs = [...Array.from({ length: 199 }, () => 0.04), 5];
    const s = summarize(xs);
    expect(s.stddev / s.median).toBeGreaterThan(5);
    expect(isUnstable(s)).toBe(false);
  });

  it("puts the default boundary at exactly 3× — strictly above it fires", () => {
    expect(isUnstable({ median: 0.1, p90: 0.3 })).toBe(false);
    expect(isUnstable({ median: 0.1, p90: 0.30001 })).toBe(true);
  });

  it("takes the factor from the caller", () => {
    expect(isUnstable({ median: 0.1, p90: 0.15 }, 1.5)).toBe(false);
    expect(isUnstable({ median: 0.1, p90: 0.16 }, 1.5)).toBe(true);
  });

  it("fires on any spread above a zero median rather than dividing by it", () => {
    expect(isUnstable({ median: 0, p90: 0.01 })).toBe(true);
    expect(isUnstable({ median: 0, p90: 0 })).toBe(false);
  });
});
