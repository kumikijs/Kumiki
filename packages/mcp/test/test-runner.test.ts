import { describe, expect, it } from "vitest";
import { callOnce, FIX_COUNTER_TESTS, FIX_FAILING_SINGLE, flag } from "./helpers/client.ts";

type Report = {
  total: number;
  passed: number;
  failed: number;
  results: Array<{ name: string; pass: boolean }>;
};

describe("kumiki_test", { timeout: 30000 }, () => {
  it("runs in-language tests and returns a structured pass/fail report", async () => {
    const res = await callOnce("kumiki_test", { path: FIX_COUNTER_TESTS });
    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.body) as Report;
    expect(parsed).toMatchObject({ total: 2, passed: 2, failed: 0 });
    expect(parsed.results.map((r) => r.name).sort()).toEqual(["dec-works", "inc-works"]);
  });

  it("supports a prefix filter", async () => {
    const res = await callOnce("kumiki_test", { path: FIX_COUNTER_TESTS, filter: "inc-*" });
    const parsed = JSON.parse(res.body) as Report;
    expect(parsed.total).toBe(1);
    expect(parsed.results[0]?.name).toBe("inc-works");
  });

  it("flags a failing test run and a filter that matches nothing", async () => {
    expect(await flag("kumiki_test", { path: FIX_FAILING_SINGLE })).toBe(true);
    expect(await flag("kumiki_test", { path: FIX_COUNTER_TESTS, filter: "nope*" })).toBe(true);
  });
});
