import { feature } from "@kumikijs/examples";
import { runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

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

  const runBoot = async (outcome: "ok" | "err", value: string) =>
    runScenario(await loadSource(BOOT, ["storage.read"]), freshRoot(), {
      effects: { boot: [{ outcome, value }] },
      steps: [{ label: "after", expect: { noErrors: true } }],
    });

  it("fails a run whose mount window reported an error", async () => {
    const report = await runBoot("err", "storage unavailable");
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.label).toBe("mount");
    expect(report.steps[0]?.errors.join(" ")).toContain("storage unavailable");
  });

  it("adds nothing when the mount window is clean", async () => {
    const report = await runBoot("ok", "fine");
    expect(report.ok).toBe(true);
    expect(report.steps.map((st) => st.label)).toEqual(["after"]);
  });
});

describe("waiting is one step, not dozens", () => {
  it.each<[string, Scenario]>([
    [
      "settles for the duration a step asks for",
      {
        steps: [
          { label: "mounted", expect: { state: { remaining: 5 } } },
          { label: "long enough for the whole countdown", do: { wait: 800 } },
          { label: "run out", expect: { noErrors: true, state: { remaining: 0 } } },
        ],
      },
    ],
    [
      "shows a stopped timer standing still for that long",
      {
        steps: [
          { label: "stopped before the first tick", do: { clickText: "Stop" } },
          { do: { wait: 800 } },
          { label: "still five", expect: { noErrors: true, state: { remaining: 5 } } },
        ],
      },
    ],
  ])("%s", async (_what, scenario) => {
    const report = await runScenario(
      await loadApp(feature("25-stop-timer")),
      freshRoot(),
      scenario,
    );
    expect(report.steps.flatMap((s) => [...s.errors, ...s.failures]).join("\n")).toBe("");
  });
});

describe("a form can be submitted from a scenario", () => {
  it("dispatches submit on the form the selector names", async () => {
    const app = await loadSource(
      withApp(`slot draft : Text = ""
slot saved : Text = ""
reducer save on=ui.submit(Entry) do= saved := draft
tile Field = input(bind=draft, placeholder="draft")
tile Entry = form(Field)
tile App   = column(Entry, text("saved: " + saved))`),
    );
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { fill: "input", value: "walk the dog" } },
        { do: { submit: "form" }, expect: { state: { saved: "walk the dog" } } },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps.flatMap((s) => s.errors)).toEqual([]);
  });
});
