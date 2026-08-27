// A fixture this tier cannot execute is refused, not run half way.
//
// The runner used to iterate the keys it knew and skip the rest, in both
// directions: a `.browser.json` handed to the headless runner passed having
// checked nothing, and a fixture here could carry `effects` — the scenario
// tier's capability mock — while its requests went out for real.

import { expect, test } from "@playwright/test";
import { type Scenario, validateScenario } from "../src/browser.ts";

test("accepts a fixture built from the keys this tier evaluates", () => {
  const scenario: Scenario = {
    steps: [
      { expect: { noErrors: true, domIncludes: ["Home"] } },
      { do: { clickText: "Open" }, expect: { animating: [".kumiki-motion-SlideIn"] } },
      { do: { setProperty: "video", property: "currentTime", value: 3 } },
      { do: { wait: 50 }, expect: { elementState: { video: { currentTime: 3 } } } },
    ],
  };
  expect(validateScenario(scenario)).toEqual([]);
});

test("names an unknown expect key", () => {
  const problems = validateScenario({
    steps: [{ label: "typo", expect: { domContains: ["x"] } as never }],
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("domContains");
  expect(problems[0]).toContain("typo");
});

test("names an unknown action", () => {
  const problems = validateScenario({ steps: [{ do: { press: "Enter" } as never }] });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("press");
});

// The counterpart of the headless runner naming `setProperty` as browser-tier:
// these two exist there and not here, and "unknown action" would read as a typo.
test("names the tier that owns key and hover", () => {
  for (const [action, kind] of [
    [{ key: "input", value: "Enter" }, "key"],
    [{ hover: "#card" }, "hover"],
  ] as const) {
    const problems = validateScenario({ steps: [{ do: action as never }] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(kind);
    expect(problems[0]).toContain("scenario-tier action");
  }
});

test("refuses a step that names two things to do", () => {
  const problems = validateScenario({
    steps: [{ do: { click: "#a", navigate: "/b" } as never }],
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("exactly one thing");
});

test("names a misspelled top-level key", () => {
  const problems = validateScenario({
    stpes: [{ expect: { noErrors: true } }],
  } as unknown as Scenario);
  expect(problems.join(" ")).toContain("stpes");
});

// It was accepted here while `evaluateExpect` never read it: a fixture using it
// asserted nothing, and if the error it asked for did occur, the tier's
// always-fatal rule failed the run anyway. Per `testing.md` it is scenario-tier
// only, so it is named as such.
test("names the tier that owns errorIncludes", () => {
  const problems = validateScenario({
    steps: [{ expect: { errorIncludes: ["boom"] } as never }],
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("scenario-tier");
});

// The value checks match the scenario tier's, because `submit` / `wait` exist
// so a fixture can be promoted from tier 2 to tier 3 unchanged.
test("refuses a wait that is not a duration", () => {
  expect(validateScenario({ steps: [{ do: { wait: "500" } as never }] })).toHaveLength(1);
  expect(validateScenario({ steps: [{ do: { wait: Number.POSITIVE_INFINITY } }] })).toHaveLength(1);
  expect(validateScenario({ steps: [{ do: { wait: 500 } }] })).toEqual([]);
});

test("refuses a fill with no string value", () => {
  expect(validateScenario({ steps: [{ do: { fill: "#a" } as never }] })).toHaveLength(1);
});

test("refuses a fixture with no steps", () => {
  const problems = validateScenario({ steps: [] });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("asserts nothing");
});

// `effects` replaces every capability's result at the scenario tier. Accepting
// it here silently would let a fixture believe its HTTP was stubbed while the
// request left the machine.
test("refuses the scenario tier's effect mocks", () => {
  const problems = validateScenario({
    steps: [{ expect: { noErrors: true } }],
    effects: { loadUser: [{ outcome: "ok", value: null }] },
  } as Scenario & { effects: unknown });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("effects");
});
