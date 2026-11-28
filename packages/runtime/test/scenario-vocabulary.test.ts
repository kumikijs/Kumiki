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

describe("validating a scenario's scripted effect results", () => {
  const scripted = (doc: object): string[] =>
    validateScenario({ steps: [{ expect: { noErrors: true } }], ...doc });

  it.each<[string, object]>([
    [
      "an ok and an err, each with a value",
      {
        effects: {
          load: [
            { outcome: "ok", value: 1 },
            { outcome: "err", value: "x" },
          ],
        },
      },
    ],
    ["a script with no value", { effects: { load: [{ outcome: "ok" }] } }],
    ["an effect with no scripts", { effects: { load: [] } }],
    ["no effects at all", { effects: {} }],
    ["a default result", { defaultEffect: { outcome: "err", value: "down" } }],
  ])("accepts %s", (_, doc) => {
    expect(scripted(doc)).toEqual([]);
  });

  it.each<[string, object, string[]]>([
    [
      "an outcome that is neither ok nor err",
      {
        effects: {
          loadSession: [{ outcome: "ok", value: null }, { outcome: "ok" }, { outcome: "error" }],
        },
      },
      ['effects.loadSession[2].outcome must be "ok" or "err", not "error"'],
    ],
    [
      "an outcome in capitals",
      { effects: { load: [{ outcome: "OK" }] } },
      ['effects.load[0].outcome must be "ok" or "err", not "OK"'],
    ],
    [
      "an outcome that is not text",
      { effects: { load: [{ outcome: true }] } },
      ['effects.load[0].outcome must be "ok" or "err", not true'],
    ],
    [
      "a script with no outcome",
      { effects: { load: [{ value: "x" }] } },
      ['effects.load[0].outcome must be "ok" or "err"; it is missing'],
    ],
    [
      "a key a script does not have",
      { effects: { load: [{ outcome: "ok", vaule: 1 }] } },
      ['effects.load[0]: unknown key "vaule" (outcome, value)'],
    ],
    [
      "a script that is text",
      { effects: { load: ["ok"] } },
      ['effects.load[0] must be a scripted result {outcome, value}, not "ok"'],
    ],
    [
      "a script that is null",
      { effects: { load: [{ outcome: "ok" }, null] } },
      ["effects.load[1] must be a scripted result {outcome, value}, not null"],
    ],
    [
      "a script that is a list",
      { effects: { load: [["ok"]] } },
      ['effects.load[0] must be a scripted result {outcome, value}, not ["ok"]'],
    ],
    [
      "scripts that are not a list",
      { effects: { load: { outcome: "ok" } } },
      ['effects.load must be a list of scripted results, not {"outcome":"ok"}'],
    ],
    [
      "effects that are a list",
      { effects: [{ outcome: "ok" }] },
      ['"effects" must map each effect\'s name to its scripted results, not [{"outcome":"ok"}]'],
    ],
    [
      "effects that are null",
      { effects: null },
      ['"effects" must map each effect\'s name to its scripted results, not null'],
    ],
    [
      "a default whose outcome is neither ok nor err",
      { defaultEffect: { outcome: "fail" } },
      ['defaultEffect.outcome must be "ok" or "err", not "fail"'],
    ],
    [
      "a default with a key a script does not have",
      { defaultEffect: { outcome: "ok", delay: 50 } },
      ['defaultEffect: unknown key "delay" (outcome, value)'],
    ],
    [
      "a default that is not a script",
      { defaultEffect: "ok" },
      ['defaultEffect must be a scripted result {outcome, value}, not "ok"'],
    ],
  ])("refuses %s, by its path", (_, doc, problems) => {
    expect(scripted(doc)).toEqual(problems);
  });

  it("reports every script's problems with the rest of the document's", () => {
    const problems = validateScenario({
      stpes: [],
      effects: { a: [{ outcome: "no", extra: 1 }], b: [{}] },
      defaultEffect: { outcome: "maybe" },
    });
    expect(problems).toEqual([
      'unknown scenario key "stpes" (steps, effects, defaultEffect)',
      'effects.a[0]: unknown key "extra" (outcome, value)',
      'effects.a[0].outcome must be "ok" or "err", not "no"',
      'effects.b[0].outcome must be "ok" or "err"; it is missing',
      'defaultEffect.outcome must be "ok" or "err", not "maybe"',
      'a scenario needs a "steps" array',
    ]);
  });

  it("leaves scripted results to the tier that runs them", () => {
    const problems = validateScenario(
      {
        steps: [{ expect: { noErrors: true } }],
        effects: { load: [{ outcome: "error" }] },
        defaultEffect: { outcome: "error" },
      },
      "browser",
    );
    expect(problems).toEqual([
      '"effects" is not supported by the browser tier: it drives a real browser',
      'unknown scenario key "defaultEffect" (steps)',
    ]);
  });
});
