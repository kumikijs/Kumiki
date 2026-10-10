import { describe, expect, it } from "vitest";
import { validateScenario } from "../src/scenario/vocabulary.ts";

describe.each(["headless", "browser"] as const)("validating a %s step", (tier) => {
  it.each([
    ["null", null],
    ["an array", ["noErrors"]],
    ["a string", "noErrors"],
  ])('reports an "expect" that is %s instead of throwing', (_, value) => {
    const problems = validateScenario({ steps: [{ label: "bad", expect: value }] }, tier);
    expect(problems).toEqual([
      `steps[0] (bad): "expect" must be an object of assertions, not ${JSON.stringify(value)}`,
    ]);
  });

  it.each([
    ["null", null],
    ["an array", ["click"]],
    ["a string", "click"],
  ])('reports a "do" that is %s instead of throwing', (_, value) => {
    const problems = validateScenario({ steps: [{ do: value }] }, tier);
    expect(problems).toEqual([
      `steps[0]: "do" must be an object naming one action, not ${JSON.stringify(value)}`,
    ]);
  });
});
