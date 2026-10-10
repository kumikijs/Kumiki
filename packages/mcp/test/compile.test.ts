import { describe, expect, it } from "vitest";
import {
  callOnce,
  FIX_A11Y,
  FIX_COUNTER_TESTS,
  FIX_COUNTER_TYPO,
  FIX_SMOKE_PANICS,
  FIX_WARNING_ONLY,
  flag,
} from "./helpers/client.ts";

describe("kumiki_check strict options", () => {
  it("hides a11y diagnostics by default but surfaces them under strictA11y", async () => {
    expect((await callOnce("kumiki_check", { path: FIX_A11Y })).body).toBe("ok — no diagnostics");
    const strict = await callOnce("kumiki_check", { path: FIX_A11Y, strictA11y: true });
    expect(strict.body).toContain("E0701");
  });

  it.each([
    {},
    { strictIcons: true },
    { strictSelectorId: true },
  ])("accepts %o on a clean file and reports no diagnostics", async (strict) => {
    const res = await callOnce("kumiki_check", { path: FIX_COUNTER_TESTS, ...strict });
    expect(res.body).toBe("ok — no diagnostics");
  });
});

describe("isError mirrors the CLI's exit code", () => {
  it.each([
    "kumiki_check",
    "kumiki_build",
  ])("flags %s failing on well-formed input", async (name) => {
    expect(await flag(name, { path: FIX_COUNTER_TYPO })).toBe(true);
  });

  it("flags a smoke run on a file that compiles but panics", async () => {
    expect(await flag("kumiki_smoke", { path: FIX_SMOKE_PANICS })).toBe(true);
    expect(await flag("kumiki_smoke", { path: FIX_COUNTER_TESTS })).toBe(false);
  });

  it.each([
    { tool: "kumiki_check", says: "W0212" },
    { tool: "kumiki_fix", says: "no errors (1 warning)" },
  ])("$tool does not flag a warning-only file, and still names it", async ({ tool, says }) => {
    const res = await callOnce(tool, { path: FIX_WARNING_ONLY });
    expect(res.isError).toBe(false);
    expect(res.body).toContain(says);
    expect(res.body).toContain("W0212");
  });
});

describe("kumiki_run_scenario", () => {
  it("flags a scenario whose step failed", async () => {
    const failing = { steps: [{ expect: { state: { count: 99 } } }] };
    expect(await flag("kumiki_run_scenario", { path: FIX_COUNTER_TESTS, scenario: failing })).toBe(
      true,
    );
    const passing = { steps: [{ expect: { noErrors: true } }] };
    expect(await flag("kumiki_run_scenario", { path: FIX_COUNTER_TESTS, scenario: passing })).toBe(
      false,
    );
  });

  it("marks a step whose action could not run as FAIL, and says why", async () => {
    // No `expect`: the failed action is the only thing that can fail this step.
    const res = await callOnce("kumiki_run_scenario", {
      path: FIX_COUNTER_TESTS,
      scenario: { steps: [{ do: { click: "#typo" } }] },
    });
    expect(res.isError).toBe(true);
    expect(res.body).toContain("[FAIL] step 0: click #typo");
    expect(res.body).toContain("action failed: no element matching selector #typo");
  });
});
