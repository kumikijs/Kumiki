// What the headless scenario runner does with a scenario it cannot run.
//
// It used to ignore it. `evaluateExpect` handled five keys and silently skipped
// the rest, so a `.browser.json` — whose assertions are all browser-tier —
// passed `kumiki run` having checked nothing, and an unknown `do` kind fell
// through to the last branch and reported a missing `select`.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const featuresDir = join(here, "..", "examples", "features");
const appsDir = join(here, "..", "examples", "apps");

const COUNTER = `slot n : Int = 0
reducer bump on=ui.click(Btn) do= n := n + 1
tile Btn = button(text="bump", onClick=bump)
tile App = column(Btn, text("n: " + n.show))
app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

async function run(scenario: Scenario): Promise<{ ok: boolean; failures: string[] }> {
  const app = await loadSource(COUNTER);
  const report = await runScenario(app, freshRoot(), scenario);
  return { ok: report.ok, failures: report.steps.flatMap((s) => s.failures) };
}

describe("an expectation the headless tier cannot evaluate is a failure", () => {
  it("rejects an unknown expect key by name", async () => {
    const r = await run({
      steps: [{ expect: { noErrors: true, domContains: ["n: 0"] } as never }],
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toContain("domContains");
  });

  // The whole reason this matters: every `.browser.json` in the corpus asserts
  // only browser-tier properties, so before this they all passed vacuously.
  it("names the tier that owns a browser-only expect key", async () => {
    const r = await run({ steps: [{ expect: { animating: [".spin"] } as never }] });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/animating/);
    expect(r.failures.join("\n")).toMatch(/browser/i);
  });

  it("rejects an unknown action kind", async () => {
    const r = await run({ steps: [{ do: { press: "Enter" } as never }] });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toContain("press");
  });

  it("names the tier that owns a browser-only action", async () => {
    const r = await run({
      steps: [{ do: { setProperty: "video", property: "currentTime", value: 3 } as never }],
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/browser/i);
  });

  it("rejects an action that names two things to do", async () => {
    const r = await run({ steps: [{ do: { click: "#a", navigate: "/b" } as never }] });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/two|more than one|exactly one/i);
  });

  it("rejects an action that names none", async () => {
    const r = await run({ steps: [{ do: {} as never }] });
    expect(r.ok).toBe(false);
  });

  // Reported together, and before the app is mounted: a document with three
  // mistakes in it should not need three runs to find them.
  it("reports every problem in the document at once, without mounting", async () => {
    const app = await loadSource(COUNTER);
    const root = freshRoot();
    const report = await runScenario(app, root, {
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

describe("the browser-tier fixtures in the corpus are refused, not passed", () => {
  function browserFixtures(): string[] {
    const out: string[] = [];
    for (const f of readdirSync(featuresDir)) {
      if (f.endsWith(".browser.json")) out.push(join(featuresDir, f));
    }
    for (const dir of readdirSync(appsDir)) {
      const appDir = join(appsDir, dir);
      let entries: string[];
      try {
        entries = readdirSync(appDir);
      } catch {
        continue;
      }
      for (const f of entries) {
        if (f.endsWith(".browser.json")) out.push(join(appDir, f));
      }
    }
    return out;
  }

  // Not every `.browser.json` is browser-*only*: 40-nested-routes asserts
  // nothing a headless DOM cannot answer, and lives at that tier for the real
  // history it exercises. So the fixtures are partitioned by what they actually
  // name, and both halves are asserted — a refusal covering both would be a
  // runner that refuses everything.
  const BROWSER_ONLY = /"(focused|visible|hidden|animating|elementState|setProperty)"\s*:/;
  const fixtures = browserFixtures().map((path) => ({
    path,
    label: path.split(/[\\/]/).slice(-1)[0] ?? path,
    browserOnly: BROWSER_ONLY.test(readFileSync(path, "utf8")),
  }));

  it("there are fixtures of both kinds", () => {
    expect(fixtures.filter((f) => f.browserOnly).length).toBeGreaterThan(0);
    expect(fixtures.filter((f) => !f.browserOnly).length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    const verb = fixture.browserOnly ? "refuses" : "accepts";
    it(`${verb} ${fixture.label}`, async () => {
      const app = await loadSource(COUNTER);
      const scenario = JSON.parse(readFileSync(fixture.path, "utf8")) as Scenario;
      const report = await runScenario(app, freshRoot(), scenario);
      const failures = report.steps.flatMap((s) => s.failures).join("\n");
      if (fixture.browserOnly) {
        expect(report.ok).toBe(false);
        expect(failures).toMatch(/browser-tier/);
        return;
      }
      // Run against a counter, so it fails on its own assertions — but never
      // on a key this runner refuses to evaluate.
      expect(failures).not.toMatch(/browser-tier|unknown (expect key|action)/);
    });
  }
});

describe("waiting is one step, not dozens", () => {
  // The countdown ticks every 100ms. Without a wait primitive, a step with no
  // `do` never settles at all, so observing three ticks meant writing dozens of
  // dummy steps — and the runner's own timing, not the app's, decided how many.
  it("settles for the duration a step asks for", async () => {
    const app = await loadApp(join(featuresDir, "25-stop-timer.kumiki"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { label: "mounted", expect: { state: { remaining: 5 } } },
        { label: "three ticks later", do: { wait: 350 }, expect: { state: { remaining: 2 } } },
        { label: "stopped", do: { clickText: "Stop" } },
        { label: "and it stays stopped", do: { wait: 350 }, expect: { state: { remaining: 2 } } },
      ],
    });
    const detail = report.steps.flatMap((s) => [...s.errors, ...s.failures]).join("\n");
    expect(detail).toBe("");
    expect(report.ok).toBe(true);
  });
});

describe("a form can be submitted from a scenario", () => {
  const FORM = `slot draft : Text = ""
slot saved : Text = ""
reducer save on=ui.submit(Entry) do= saved := draft
tile Field = input(bind=draft, placeholder="draft")
tile Entry = form(Field)
tile App   = column(Entry, text("saved: " + saved))
app Forms
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("dispatches submit on the form the selector names", async () => {
    const app = await loadSource(FORM);
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { fill: "input", value: "walk the dog" } },
        { do: { submit: "form" }, expect: { state: { saved: "walk the dog" } } },
      ],
    });
    expect(report.steps.flatMap((s) => [...s.errors, ...s.failures]).join("\n")).toBe("");
    expect(report.ok).toBe(true);
  });
});
