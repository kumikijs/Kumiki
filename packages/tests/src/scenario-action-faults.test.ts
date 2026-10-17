import { feature } from "@kumikijs/examples";
import { type Action, type AppShape, runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

const run = async (app: AppShape, scenario: Scenario) => runScenario(app, freshRoot(), scenario);

describe("an action fails on a target it cannot drive", () => {
  const FILLABLE = withApp(`slot note : Text = ""
tile Box = box(text("not a field")) {id: "box"}
tile Field = input(bind=note) {id: "field"}
tile App = column(Box, Field, text("note: " + note))`);

  it("reports a fill whose selector holds no text, naming the element, on its own channel", async () => {
    const report = await run(await loadSource(FILLABLE), {
      steps: [{ do: { fill: "#box", value: "hello" } }],
    });
    expect(report.ok).toBe(false);
    const step = report.steps[0];
    expect(step?.actionError).toContain("#box matched <div>");
    expect(step?.actionError).toContain("holds no text to fill");
    expect(step?.errors).toEqual([]);
    expect(step?.expectedErrors).toEqual([]);
  });

  it("still fills the control that does hold text", async () => {
    const report = await run(await loadSource(FILLABLE), {
      steps: [{ do: { fill: "#field", value: "hello" }, expect: { state: { note: "hello" } } }],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });
});

describe("a broken selector cannot satisfy errorIncludes", () => {
  const SELECTORS = withApp(`slot n : Int = 0
reducer bump on=ui.click(Btn) do= n := n + 1
tile Btn   = button(text="bump", onClick=bump) {id: "btn"}
tile Field = input(placeholder="x") {id: "field"}
tile App   = column(Btn, Field, text("n: " + n.show))`);

  it.each<Action>([
    { click: "#typo" },
    { focus: "#typo" },
    { blur: "#typo" },
    { hover: "#typo" },
    { key: "#typo", value: "Enter" },
    { fill: "#typo", value: "x" },
    { choose: "#typo", value: "x" },
    { submit: "#typo" },
    { clickText: "no such button" },
  ])("fails the step for %o, and refuses to call it a reported error", async (action) => {
    const report = await run(await loadSource(SELECTORS), {
      steps: [{ do: action, expect: { errorIncludes: ["no "] } }],
    });
    const step = report.steps[0];
    expect(report.ok).toBe(false);
    expect(step?.actionError).toBeTruthy();
    expect(step?.errors).toEqual([]);
    expect(step?.expectedErrors).toEqual([]);
    expect(step?.failures.join(" ")).toContain('expected an error including "no " but got: none');
  });

  it.each<Action>([
    { click: "#typo" },
    { focus: "#typo" },
    { hover: "#typo" },
    { key: "#typo", value: "Enter" },
  ])("keeps a broken selector out of noErrors for %o", async (action) => {
    const report = await run(await loadSource(SELECTORS), {
      steps: [{ do: action, expect: { noErrors: true } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain("no element matching selector #typo");
    expect(report.steps[0]?.failures).toEqual([]);
  });
});

describe("a dispatch naming a reducer the app does not have cannot pass", () => {
  const RENAMED = withApp(`slot todos : Text = ""
reducer addTodoItem on=ui.click(Btn) do= todos := todos + "x"
tile Btn = button(text="add", onClick=addTodoItem) {id: "btn"}
tile App = column(Btn, text("todos: " + todos))`);

  it("fails the step its assertion would otherwise have passed", async () => {
    const report = await run(await loadSource(RENAMED), {
      steps: [{ do: { dispatch: "addTodo" }, expect: { state: { todos: "" } } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain('no reducer named "addTodo"');
  });

  it("refuses to let errorIncludes claim it", async () => {
    const report = await run(await loadSource(RENAMED), {
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
    const report = await run(await loadSource(RENAMED), {
      steps: [{ do: { dispatch: "addTodoIten" } }],
    });
    expect(report.steps[0]?.actionError).toContain('did you mean "addTodoItem"');
  });

  it("offers no suggestion when nothing is close", async () => {
    const report = await run(await loadSource(RENAMED), {
      steps: [{ do: { dispatch: "purgeEverything" } }],
    });
    const fault = report.steps[0]?.actionError ?? "";
    expect(fault).toContain('no reducer named "purgeEverything"');
    expect(fault).not.toContain("did you mean");
  });

  // Naming the first one declared would let declaration order answer what the distance does not.
  it.each([
    [["addA", "addB"], '"addA" or "addB"'],
    [["addB", "addA"], '"addA" or "addB"'],
    [["addC", "addA", "addB"], '"addA", "addB" or "addC"'],
  ])("names every reducer equally close (declared %j)", async (names, named) => {
    const app = await loadSource(
      withApp(
        [
          "slot n : Int = 0",
          ...names.map((r) => `reducer ${r} on=ui.click(Btn${r}) do= n := n + 1`),
          ...names.map((r) => `tile Btn${r} = button(text="${r}", onClick=${r})`),
          `tile App = column(${names.map((r) => `Btn${r}`).join(", ")}, text("n: " + n.show))`,
        ].join("\n"),
      ),
    );
    const report = await run(app, { steps: [{ do: { dispatch: "add" } }] });
    expect(report.steps[0]?.actionError).toBe(`no reducer named "add" — did you mean ${named}?`);
  });

  it("still dispatches the reducer that does exist", async () => {
    const report = await run(await loadSource(RENAMED), {
      steps: [{ do: { dispatch: "addTodoItem" }, expect: { state: { todos: "x" } } }],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps.flatMap((s) => s.errors)).toEqual([]);
  });
});

describe("a dispatch to an id-scoped reducer", () => {
  const selectorId = (): Promise<AppShape> => loadApp(feature("51-selector-id"));

  it("fails when the id scope would drop it, naming the payload that would reach it", async () => {
    const report = await run(await selectorId(), {
      steps: [{ do: { dispatch: "scopedMiss" }, expect: { state: { log: "" } } }],
    });
    expect(report.ok).toBe(false);
    const fault = report.steps[0]?.actionError ?? "";
    expect(fault).toContain('reducer "scopedMiss" is scoped to #edit');
    expect(fault).toContain('{"id": "edit"}');
  });

  it("fires when the payload carries its id", async () => {
    const report = await run(await selectorId(), {
      steps: [
        {
          do: { dispatch: "scopedMiss", payload: { id: "edit" } },
          expect: { state: { log: "miss;" } },
        },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps.flatMap((s) => s.errors)).toEqual([]);
  });

  it("leaves an unscoped reducer alone", async () => {
    const report = await run(await selectorId(), {
      steps: [{ do: { dispatch: "plain" }, expect: { state: { log: "plain;" } } }],
    });
    expect(report.steps[0]?.actionError).toBeUndefined();
    expect(report.ok).toBe(true);
  });
});

describe("an action whose seam is missing fails rather than doing nothing", () => {
  const COUNTER = withApp(`slot n : Int = 0
reducer bump on=ui.click(Btn) do= n := n + 1
tile Btn = button(text="bump", onClick=bump)
tile App = column(Btn, text("n: " + n.show))`);

  it.each<["_dispatch" | "_navigate", Action]>([
    ["_dispatch", { dispatch: "bump" }],
    ["_navigate", { navigate: "/" }],
  ])("fails an action with no %s seam", async (seam, action) => {
    const app = await loadSource(COUNTER);
    Object.defineProperty(app, seam, { get: () => undefined, set: () => {}, configurable: true });
    const report = await run(app, { steps: [{ do: action }] });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain(seam);
  });
});
