// What the headless scenario runner does with a scenario it cannot run.
//
// It used to ignore it. `evaluateExpect` handled five keys and silently skipped
// the rest, so a `.browser.json` — whose assertions are all browser-tier —
// passed `kumiki run` having checked nothing, and an unknown `do` kind fell
// through to the last branch and reported a missing `select`.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape } from "@kumikijs/runtime";
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

  // The whole reason this matters: a fixture written for the browser tier
  // asserts things a headless DOM has no answer for, and passed anyway.
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

  // `key` carries the key to press in `value`, the way `fill` and `choose` carry
  // theirs — and unlike those two it cannot be empty. `KeyboardEventInit.key`
  // defaults to `""`, so a missing value and an empty one build the same event,
  // and the listener never reads it: the reducer fires either way and the step
  // reports success having pressed nothing anyone can name.
  it("refuses a key press that names no key", async () => {
    for (const action of [{ key: "input" }, { key: "input", value: "" }]) {
      const r = await run({ steps: [{ do: action as never }] });
      expect(r.ok, JSON.stringify(action)).toBe(false);
      expect(r.failures.join("\n")).toMatch(/"key" needs a non-empty string "value"/);
    }
  });

  it("rejects an action that names two things to do", async () => {
    const r = await run({ steps: [{ do: { click: "#a", navigate: "/b" } as never }] });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/two|more than one|exactly one/i);
  });

  // `setTimeout(Infinity)` does not fit a 32-bit delay and runs at 1ms, so a
  // step asking to wait forever ran as one asking not to wait — and passed.
  it("refuses a wait that is not a finite duration", async () => {
    const r = await run({ steps: [{ do: { wait: Number.POSITIVE_INFINITY } }] });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/wait/);
  });

  it("refuses a wait longer than any observation window", async () => {
    expect((await run({ steps: [{ do: { wait: 600_000 } }] })).ok).toBe(false);
    expect((await run({ steps: [{ do: { wait: -1 } }] })).ok).toBe(false);
    expect((await run({ steps: [{ do: { wait: "500" } as never }] })).ok).toBe(false);
  });

  it("rejects an action that names none", async () => {
    const r = await run({ steps: [{ do: {} as never }] });
    expect(r.ok).toBe(false);
  });

  // A misspelled top-level key is the same failure one level up: `steps` reads
  // as absent, so every assertion under it is skipped. It used to reach the
  // runner's loop and throw `steps is not iterable` — after the mount, which is
  // exactly what validating first is supposed to prevent.
  it("names a misspelled top-level key instead of crashing on it", async () => {
    const r = await run({ stpes: [{ expect: { state: { n: 999 } } }] } as unknown as Scenario);
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toContain("stpes");
  });

  it("refuses a document whose steps are not a list", async () => {
    const r = await run({ steps: { first: {} } } as unknown as Scenario);
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/"steps"/);
  });

  // A scenario with nothing in it asserted nothing and said so with `ok: true`.
  it("refuses a document with no steps at all", async () => {
    const r = await run({ steps: [] });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/no steps|asserts nothing/i);
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

// A verb aimed at something it cannot drive fails the step. Every action but
// `fill` already did: `fill` wrote a property the element does not have,
// dispatched two events nothing listens for, and passed — a step asserting
// nothing, reported as coverage.
describe("an action fails on a target it cannot drive", () => {
  const FILLABLE = `slot note : Text = ""
tile Box = box(text("not a field")) {id: "box"}
tile Field = input(bind=note) {id: "field"}
tile App = column(Box, Field, text("note: " + note))
app Fillable
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("reports a fill whose selector holds no text, naming the element", async () => {
    const app = await loadSource(FILLABLE);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { fill: "#box", value: "hello" } }],
    });
    expect(report.ok).toBe(false);
    const errors = report.steps.flatMap((st) => st.errors).join(" ");
    expect(errors).toContain("#box matched <div>");
    expect(errors).toContain("holds no text to fill");
  });

  it("still fills the control that does hold text", async () => {
    const app = await loadSource(FILLABLE);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { fill: "#field", value: "hello" }, expect: { state: { note: "hello" } } }],
    });
    expect(report.steps.flatMap((st) => st.failures)).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

// Everything the runtime reported between `mount` and the first scripted action
// used to be dropped: the step loop opened by clearing the buffer. An
// `app.start` effect that failed with no `.err` reducer — the shape an
// unfixtured HTTP request takes — was reported by the runtime and thrown away,
// and the run said `ok: true`.
describe("the first paint is a step like any other", () => {
  const BOOT = `slot n : Int = 0
effect boot cap=storage.read
            in=Unit
            out=Result(Text, Text)
            policy=once
            map-request={key: "nope", decode: Decoder.Text()}
reducer start on=app.start do= emit boot()
tile App = column(text("n: " + n.show))
app Boot
    caps   = [storage.read]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("fails a run whose mount window reported an error", async () => {
    const app = await loadSource(BOOT, ["storage.read"]);
    const report = await runScenario(app, freshRoot(), {
      effects: { boot: [{ outcome: "err", value: "storage unavailable" }] },
      steps: [{ label: "after", expect: { noErrors: true } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.label).toBe("mount");
    expect(report.steps[0]?.errors.join(" ")).toContain("storage unavailable");
  });

  // …and stays out of the way otherwise: a clean first paint adds no step, so
  // a caller reading `steps[0]` still gets the first scripted one.
  it("adds nothing when the mount window is clean", async () => {
    const app = await loadSource(BOOT, ["storage.read"]);
    const report = await runScenario(app, freshRoot(), {
      effects: { boot: [{ outcome: "ok", value: "fine" }] },
      steps: [{ label: "after", expect: { noErrors: true } }],
    });
    expect(report.ok).toBe(true);
    expect(report.steps.map((st) => st.label)).toEqual(["after"]);
  });
});

describe("waiting is one step, not dozens", () => {
  // The countdown ticks every 100ms from 5 and clamps at 0. Without a wait
  // primitive, a step with no `do` never settles at all, so watching it run
  // down meant writing dozens of dummy steps — and the runner's own timing,
  // not the app's, decided how many.
  //
  // Asserted at the clamp rather than mid-flight: how many ticks land inside a
  // given window is the scheduler's business, and a test that counts them is
  // measuring the machine.
  const timer = (): Promise<AppShape> => loadApp(join(featuresDir, "25-stop-timer.kumiki"));

  it("settles for the duration a step asks for", async () => {
    const report = await runScenario(await timer(), freshRoot(), {
      steps: [
        { label: "mounted", expect: { state: { remaining: 5 } } },
        { label: "long enough for the whole countdown", do: { wait: 800 } },
        { label: "run out", expect: { noErrors: true, state: { remaining: 0 } } },
      ],
    });
    expect(report.steps.flatMap((s) => [...s.errors, ...s.failures]).join("\n")).toBe("");
  });

  // The other half: a wait that observes nothing happening is the only way to
  // say `stop-timer` worked. The same 800ms leaves the countdown untouched.
  it("shows a stopped timer standing still for that long", async () => {
    const report = await runScenario(await timer(), freshRoot(), {
      steps: [
        { label: "stopped before the first tick", do: { clickText: "Stop" } },
        { do: { wait: 800 } },
        { label: "still five", expect: { noErrors: true, state: { remaining: 5 } } },
      ],
    });
    expect(report.steps.flatMap((s) => [...s.errors, ...s.failures]).join("\n")).toBe("");
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
