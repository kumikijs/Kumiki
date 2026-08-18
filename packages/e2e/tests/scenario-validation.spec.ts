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

test("refuses a step that names two things to do", () => {
  const problems = validateScenario({
    steps: [{ do: { click: "#a", navigate: "/b" } as never }],
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("exactly one thing");
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
