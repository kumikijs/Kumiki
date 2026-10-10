import { readFileSync } from "node:fs";
import { browserScenarioCases } from "@kumikijs/examples";
import { runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const COUNTER = withApp(`slot n : Int = 0
reducer bump on=ui.click(Btn) do= n := n + 1
tile Btn = button(text="bump", onClick=bump)
tile App = column(Btn, text("n: " + n.show))`);

async function failuresOf(scenario: Scenario): Promise<string> {
  const report = await runScenario(await loadSource(COUNTER), freshRoot(), scenario);
  expect(report.ok).toBe(false);
  return report.steps.flatMap((s) => s.failures).join("\n");
}

describe("an expectation the headless tier cannot evaluate is a failure", () => {
  it.each<[string, Scenario, RegExp[]]>([
    [
      "an unknown expect key, by name",
      { steps: [{ expect: { noErrors: true, domContains: ["n: 0"] } as never }] },
      [/domContains/],
    ],
    [
      "a browser-only expect key, naming the tier that owns it",
      { steps: [{ expect: { animating: [".spin"] } as never }] },
      [/animating/, /browser/i],
    ],
    ["an unknown action kind", { steps: [{ do: { press: "Enter" } as never }] }, [/press/]],
    [
      "a browser-only action, naming the tier that owns it",
      { steps: [{ do: { setProperty: "video", property: "currentTime", value: 3 } as never }] },
      [/browser/i],
    ],
    [
      "a key press with no key",
      { steps: [{ do: { key: "input" } as never }] },
      [/"key" needs a non-empty string "value"/],
    ],
    [
      "a key press with an empty key",
      { steps: [{ do: { key: "input", value: "" } }] },
      [/"key" needs a non-empty string "value"/],
    ],
    [
      "an action that names two things to do",
      { steps: [{ do: { click: "#a", navigate: "/b" } as never }] },
      [/two|more than one|exactly one/i],
    ],
    ["an action that names none", { steps: [{ do: {} as never }] }, []],
    [
      "a wait that is not a finite duration",
      { steps: [{ do: { wait: Number.POSITIVE_INFINITY } }] },
      [/wait/],
    ],
    ["a wait longer than any observation window", { steps: [{ do: { wait: 600_000 } }] }, []],
    ["a negative wait", { steps: [{ do: { wait: -1 } }] }, []],
    ["a wait given as text", { steps: [{ do: { wait: "500" } as never }] }, []],
    [
      "a misspelled top-level key, by name",
      { stpes: [{ expect: { state: { n: 999 } } }] } as unknown as Scenario,
      [/stpes/],
    ],
    [
      "a document whose steps are not a list",
      { steps: { first: {} } } as unknown as Scenario,
      [/"steps"/],
    ],
    ["a document with no steps at all", { steps: [] }, [/no steps|asserts nothing/i]],
  ])("refuses %s", async (_what, scenario, mentions) => {
    const failures = await failuresOf(scenario);
    for (const m of mentions) expect(failures).toMatch(m);
  });

  it("reports every problem in the document at once, without mounting", async () => {
    const root = freshRoot();
    const report = await runScenario(await loadSource(COUNTER), root, {
      steps: [
        { expect: { animating: [".a"] } as never },
        { do: { press: "Enter" } as never },
        { expect: { domContains: ["x"] } as never },
      ],
    });
    expect(report.ok).toBe(false);
    const text = report.steps.flatMap((s) => s.failures).join("\n");
    expect(text).toMatch(/animating/);
    expect(text).toMatch(/press/);
    expect(text).toMatch(/domContains/);
    expect(root.childElementCount).toBe(0);
  });
});

const BROWSER_EXPECT_KEYS = new Set(["focused", "visible", "hidden", "animating", "elementState"]);
const BROWSER_ACTION_KEYS = new Set(["setProperty"]);

/** Whether any step of `scenario` asks for something only a real browser can do or see. */
function asksForBrowser(scenario: Scenario): boolean {
  return scenario.steps.some(
    (step) =>
      Object.keys(step.expect ?? {}).some((k) => BROWSER_EXPECT_KEYS.has(k)) ||
      Object.keys(step.do ?? {}).some((k) => BROWSER_ACTION_KEYS.has(k)),
  );
}

describe("the browser-tier fixtures in the corpus are refused, not passed", () => {
  const fixtures = browserScenarioCases().map(({ scenario: path, label }) => {
    const scenario = JSON.parse(readFileSync(path, "utf8")) as Scenario;
    return { label, scenario, browserOnly: asksForBrowser(scenario) };
  });

  it.each(fixtures.filter((f) => f.browserOnly))("refuses $label", async ({ scenario }) => {
    expect(await failuresOf(scenario)).toMatch(/browser-tier/);
  });

  it.each(fixtures.filter((f) => !f.browserOnly))("accepts $label", async ({ scenario }) => {
    const report = await runScenario(await loadSource(COUNTER), freshRoot(), scenario);
    const failures = report.steps.flatMap((s) => s.failures).join("\n");
    expect(failures).not.toMatch(/browser-tier|unknown (expect key|action)/);
  });
});
