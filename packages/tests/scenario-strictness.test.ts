import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape } from "@kumikijs/runtime";
import { type Action, runScenario, type Scenario } from "@kumikijs/runtime";
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

  it("refuses a document with no steps at all", async () => {
    const r = await run({ steps: [] });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/no steps|asserts nothing/i);
  });

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
      expect(failures).not.toMatch(/browser-tier|unknown (expect key|action)/);
    });
  }
});

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
    const fault = report.steps[0]?.actionError ?? "";
    expect(fault).toContain("#box matched <div>");
    expect(fault).toContain("holds no text to fill");
  });

  it("keeps the fault off the channel the app reports on", async () => {
    const app = await loadSource(FILLABLE);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { fill: "#box", value: "hello" } }],
    });
    expect(report.steps[0]?.errors).toEqual([]);
    expect(report.steps[0]?.expectedErrors).toEqual([]);
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

describe("a broken selector cannot satisfy errorIncludes", () => {
  const APP = `slot n : Int = 0
reducer bump on=ui.click(Btn) do= n := n + 1
tile Btn   = button(text="bump", onClick=bump) {id: "btn"}
tile Field = input(placeholder="x") {id: "field"}
tile App   = column(Btn, Field, text("n: " + n.show))
app Selectors
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  const missing: Action[] = [
    { click: "#typo" },
    { focus: "#typo" },
    { blur: "#typo" },
    { hover: "#typo" },
    { key: "#typo", value: "Enter" },
    { fill: "#typo", value: "x" },
    { choose: "#typo", value: "x" },
    { submit: "#typo" },
    { clickText: "no such button" },
  ];

  for (const action of missing) {
    const kind = Object.keys(action)[0];
    it(`fails the step for ${kind}, and refuses to call it a reported error`, async () => {
      const app = await loadSource(APP);
      const report = await runScenario(app, freshRoot(), {
        steps: [{ do: action, expect: { errorIncludes: ["no "] } }],
      });
      const step = report.steps[0];
      expect(report.ok, JSON.stringify(action)).toBe(false);
      // What went wrong, on its own channel...
      expect(step?.actionError, JSON.stringify(action)).toBeTruthy();
      // ...and nowhere else: neither claimable by `errorIncludes` nor countable as something the app said.
      expect(step?.errors, JSON.stringify(action)).toEqual([]);
      expect(step?.expectedErrors, JSON.stringify(action)).toEqual([]);
      expect(step?.failures.join(" "), JSON.stringify(action)).toContain(
        'expected an error including "no " but got: none',
      );
    });
  }

  it("keeps a broken selector out of noErrors", async () => {
    const app = await loadSource(APP);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { click: "#typo" }, expect: { noErrors: true } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain("no element matching selector #typo");
    expect(report.steps[0]?.failures).toEqual([]);
  });
});

describe("a dispatch naming a reducer the app does not have cannot pass", () => {
  const RENAMED = `slot todos : Text = ""
reducer addTodoItem on=ui.click(Btn) do= todos := todos + "x"
tile Btn = button(text="add", onClick=addTodoItem) {id: "btn"}
tile App = column(Btn, text("todos: " + todos))
app Todos
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("fails the step its assertion would otherwise have passed", async () => {
    const app = await loadSource(RENAMED);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { dispatch: "addTodo" }, expect: { state: { todos: "" } } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain('no reducer named "addTodo"');
  });

  it("refuses to let errorIncludes claim it", async () => {
    const app = await loadSource(RENAMED);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { dispatch: "addTodo" }, expect: { errorIncludes: ["no reducer"] } }],
    });
    const step = report.steps[0];
    expect(report.ok).toBe(false);
    expect(step?.actionError).toBeTruthy();
    expect(step?.errors).toEqual([]);
    expect(step?.expectedErrors).toEqual([]);
    expect(step?.failures.join(" ")).toContain(
      'expected an error including "no reducer" but got: none',
    );
  });

  it("names the reducer the rename left behind", async () => {
    const app = await loadSource(RENAMED);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { dispatch: "addTodoIten" } }],
    });
    expect(report.steps[0]?.actionError).toContain('did you mean "addTodoItem"');
  });

  it("offers no suggestion when nothing is close", async () => {
    const app = await loadSource(RENAMED);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { dispatch: "purgeEverything" } }],
    });
    const fault = report.steps[0]?.actionError ?? "";
    expect(fault).toContain('no reducer named "purgeEverything"');
    expect(fault).not.toContain("did you mean");
  });

  it("still dispatches the reducer that does exist", async () => {
    const app = await loadSource(RENAMED);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { dispatch: "addTodoItem" }, expect: { state: { todos: "x" } } }],
    });
    expect(report.steps.flatMap((s) => [...s.errors, ...s.failures])).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("fails a dispatch that the id scope would drop", async () => {
    const app = await loadApp(join(featuresDir, "51-selector-id.kumiki"));
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { dispatch: "scopedMiss" }, expect: { state: { log: "" } } }],
    });
    expect(report.ok).toBe(false);
    const fault = report.steps[0]?.actionError ?? "";
    expect(fault).toContain('reducer "scopedMiss" is scoped to #edit');
    expect(fault).toContain('{"id": "edit"}');
  });

  it("fires that same reducer when the payload carries its id", async () => {
    const app = await loadApp(join(featuresDir, "51-selector-id.kumiki"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        {
          do: { dispatch: "scopedMiss", payload: { id: "edit" } },
          expect: { state: { log: "miss;" } },
        },
      ],
    });
    expect(report.steps.flatMap((s) => [...s.errors, ...s.failures])).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("leaves an unscoped reducer alone", async () => {
    const app = await loadApp(join(featuresDir, "51-selector-id.kumiki"));
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { dispatch: "plain" }, expect: { state: { log: "plain;" } } }],
    });
    expect(report.steps[0]?.actionError).toBeUndefined();
    expect(report.ok).toBe(true);
  });
});

describe("an action whose seam is missing fails rather than doing nothing", () => {
  function withoutSeam(app: AppShape, seam: "_dispatch" | "_navigate"): AppShape {
    Object.defineProperty(app, seam, {
      get: () => undefined,
      set: () => {},
      configurable: true,
    });
    return app;
  }

  it("fails a dispatch with no _dispatch seam", async () => {
    const app = withoutSeam(await loadSource(COUNTER), "_dispatch");
    const report = await runScenario(app, freshRoot(), { steps: [{ do: { dispatch: "bump" } }] });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toMatch(/_dispatch/);
  });

  it("fails a navigate with no _navigate seam", async () => {
    const app = withoutSeam(await loadSource(COUNTER), "_navigate");
    const report = await runScenario(app, freshRoot(), { steps: [{ do: { navigate: "/" } }] });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toMatch(/_navigate/);
  });
});

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
