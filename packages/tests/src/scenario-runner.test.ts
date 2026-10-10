import { feature } from "@kumikijs/examples";
import { createEpisodeLogger, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

const counter = feature("01-slot-and-reducer");

describe("scenario runner", () => {
  it("drives a reducer by name and asserts slot state", async () => {
    const app = await loadApp(counter);
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { dispatch: "inc" }, expect: { noErrors: true, state: { count: 1 } } },
        { do: { dispatch: "inc" }, expect: { state: { count: 2 } } },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps[1]?.state.count).toBe(2);
  });

  it("drives the UI by visible text", async () => {
    const app = await loadApp(counter);
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { clickText: "+1" }, expect: { state: { count: 1 }, domIncludes: ["Count: 1"] } },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("reports assertion failures with detail instead of throwing", async () => {
    const app = await loadApp(counter);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { dispatch: "inc" }, expect: { state: { count: 99 } } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.failures[0]).toContain("count");
  });

  it("answers a manifest-registered custom effect from the scenario's script", async () => {
    const app = await loadApp(feature("27-custom-capability"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { clickText: "Track" }, expect: { noErrors: true, state: { sent: 1 } } },
        { do: { clickText: "Track" }, expect: { state: { sent: 2 } } },
      ],
      effects: { track: [{ outcome: "ok" }, { outcome: "ok" }] },
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("keeps running later reducers in the chain when an earlier one panics", async () => {
    const app = await loadSource(
      withApp(`
slot first : Int = 0
slot last  : Int = 0
reducer runFirst on=ui.click(B) do= first := first + 1
reducer boom     on=ui.click(B) do= last  := panic("nope")
reducer runLast  on=ui.click(B) do= last  := last + 1
tile B = button(text="go")
tile App = column(B, text(first.show), text(last.show))
`),
    );
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { clickText: "go" } }],
    });
    const step = report.steps[0];
    expect(step?.errors.some((e) => e.includes('panic in reducer "boom"'))).toBe(true);
    expect(step?.state.first).toBe(1);
    expect(step?.state.last).toBe(1);
  });
});

describe("errorIncludes", () => {
  const atomicity = feature("63-reducer-batch-atomicity");

  const toCeiling = [
    { do: { clickText: "bump" } },
    { do: { clickText: "bump" } },
    { do: { clickText: "bump" } },
  ];

  it("passes when the named error is reported, and keeps it out of the failures", async () => {
    const app = await loadApp(atomicity);
    const report = await runScenario(app, freshRoot(), {
      steps: [
        ...toCeiling,
        {
          do: { clickText: "bump" },
          // `noErrors` means "nothing this step did not ask for", so the two compose instead of contradicting.
          expect: { noErrors: true, errorIncludes: ['reducer "bump" was rejected'] },
        },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
    const last = report.steps[3];
    expect(last?.errors).toEqual([]);
    expect(last?.expectedErrors).toHaveLength(1);
    expect(last?.expectedErrors[0]).toContain("cannot hold 4 (between(0, 3))");
    expect(last?.actionError).toBeUndefined();
  });

  it("fails when the named error is not reported", async () => {
    const app = await loadApp(atomicity);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { clickText: "bump" }, expect: { errorIncludes: ["was rejected"] } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.failures[0]).toContain('expected an error including "was rejected"');
    expect(report.steps[0]?.failures[0]).toContain("none");
  });

  it("still fails on an error the step did not name", async () => {
    const app = await loadApp(atomicity);
    const report = await runScenario(app, freshRoot(), {
      steps: [...toCeiling, { do: { clickText: "bump" }, expect: { errorIncludes: [] } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[3]?.errors).toHaveLength(1);
  });
});

describe("a step cannot drive a control the platform refuses", () => {
  const disabled = feature("95-disabled-controls-refuse-a-step");
  const typeIntoLocked = { fill: "#locked", value: "typed" };

  it("fails the step and leaves the slot where it was", async () => {
    const app = await loadApp(disabled);
    const report = await runScenario(app, freshRoot(), { steps: [{ do: typeIntoLocked }] });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain("<input> is disabled");
    expect(report.steps[0]?.state.locked).toBe("sealed");
    expect(report.steps[0]?.state.typed).toBe(0);
  });

  it("keeps the refusal off the error channel, out of errorIncludes' reach", async () => {
    const app = await loadApp(disabled);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: typeIntoLocked, expect: { errorIncludes: ["is disabled"] } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.errors).toEqual([]);
    expect(report.steps[0]?.failures[0]).toContain("but got: none");
  });

  it("actionErrorIncludes claims it, and moves it off the failing channel", async () => {
    const app = await loadApp(disabled);
    const report = await runScenario(app, freshRoot(), {
      steps: [
        {
          do: typeIntoLocked,
          expect: { noErrors: true, actionErrorIncludes: ["<input> is disabled"] },
        },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps[0]?.actionError).toBeUndefined();
    expect(report.steps[0]?.expectedActionError).toContain("is disabled");
  });

  it("a step that asks to be refused and is not refused fails", async () => {
    const app = await loadApp(disabled);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { fill: "#live", value: "x" }, expect: { actionErrorIncludes: ["disabled"] } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.failures[0]).toContain("but it ran");
  });
});

describe("a debounced effect", () => {
  it("runs the textarea's ui.input reducer and rides the episode that started it", async () => {
    const app = await loadApp(feature("20-effect-storage"));
    const logger = createEpisodeLogger({ memoryMax: 20 });
    const report = await runScenario(
      app,
      freshRoot(),
      {
        steps: [
          { expect: { noErrors: true, state: { ready: true } } },
          {
            do: { fill: "textarea", value: "buy milk" },
            expect: { noErrors: true, state: { text: "buy milk", status: "saved" } },
          },
        ],
        effects: {
          loadText: [{ outcome: "err", value: "SecurityError" }],
          saveText: [{ outcome: "ok" }],
        },
      },
      { settleMs: 400, episodeLogger: logger },
    );
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps[1]?.emits.some((e) => e.effect === "saveText")).toBe(true);

    const eps = logger.list();
    const reducersOf = (ep: (typeof eps)[number]): string[] =>
      ep.steps.filter((s) => s.kind === "reducer").map((s) => (s as { name: string }).name);
    const edit = eps.find((ep) => reducersOf(ep).includes("edit"));
    if (!edit) throw new Error("no episode ran the edit reducer");
    const kinds = edit.steps.map((s) => s.kind);
    expect(kinds).toContain("effect-start");
    expect(kinds).toContain("effect-end");
    expect(reducersOf(edit)).toEqual(expect.arrayContaining(["edit", "saved"]));
    expect(edit.status).toBe("completed");
    expect(eps.filter((ep) => ep.trigger.kind === "ui.input")).toHaveLength(1);
    expect(
      eps.filter((ep) => ep.trigger.kind.startsWith("effect.") && reducersOf(ep).includes("saved")),
    ).toEqual([]);
  });
});
