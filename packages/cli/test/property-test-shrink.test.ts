// `kumiki test` shrinks a property-test counterexample inside the domain its
// `for-all` declares (testing.md §8.3.2): the descriptor codegen folds a
// refinement into is the one shrinking reads, so a counterexample is a value
// the generator could have produced. A `run-reducer` batch a refinement
// refuses reads the state it was given, so shrinking does not take it as a
// smaller counterexample, and a generated case that is itself refused is
// reported as generated, followed by the rejection.

import { describe, expect, it } from "vitest";
import { runTestsSource } from "../src/smoke.ts";

const program = (slot: string, reducer: string, tests: string): string =>
  [
    slot,
    "",
    reducer,
    "",
    'tile B = button(text="go", onClick=go)',
    "tile App = column(B)",
    "",
    "app PropertyShrink",
    '    routes = {"/" -> App, "/404" -> App}',
    "    init   = []",
    "",
    tests,
    "",
  ].join("\n");

async function actuals(source: string): Promise<Record<string, string | undefined>> {
  const results = await runTestsSource(source);
  return Object.fromEntries(results.map((r) => [r.name, r.pass ? "pass" : r.actual]));
}

describe("a property-test counterexample", () => {
  it("shrinks to the smallest value its refinement admits", { timeout: 30_000 }, async () => {
    const source = program(
      "slot count : Int = 0",
      "reducer go on=ui.click(B) do= count := count + 1",
      [
        "test positive-is-never-negative =",
        "    property-test",
        "        for-all   = {v: Int where positive}",
        "        given     = {slots: {}, event: {type: ui.click, target: B}}",
        "        invariant = v < 0",
      ].join("\n"),
    );
    expect(await actuals(source)).toEqual({
      "positive-is-never-negative": 'counterexample (case 1/100): {"v":1}',
    });
  });

  it("is never one whose run-reducer batch was refused", { timeout: 30_000 }, async () => {
    const source = program(
      "slot count : Int where between(0, 100) = 0",
      "reducer go on=ui.click(B) do= count := count - 1",
      [
        // Fails for n in 1..11, where `go` commits 0..10, and at n = 0, where
        // the batch is refused and the state stays 0.
        "test dec-stays-above-ten =",
        "    property-test",
        "        for-all   = {n: Int where between(0, 100)}",
        "        given     = {slots: {count: n}, event: {type: ui.click, target: B}}",
        "        invariant = run-reducer(go).slots.count > 10",
        "",
        "test dec-subtracts-one =",
        "    property-test",
        "        for-all   = {n: Int where between(0, 3)}",
        "        given     = {slots: {count: n}, event: {type: ui.click, target: B}}",
        "        invariant = run-reducer(go).slots.count == n - 1",
      ].join("\n"),
    );
    expect(await actuals(source)).toEqual({
      "dec-stays-above-ten": 'counterexample (case 1/100): {"n":1}',
      "dec-subtracts-one":
        'counterexample (case 3/100): {"n":0} — reducer "go" was rejected: slot "count" cannot hold -1 (between(0, 100))',
    });
  });
});
