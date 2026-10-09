import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

function freshRoot(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

/** A one-slot app whose reducers are dispatched by name. */
function app(decl: string, body: string, tiles = 'tile App = column(text("x"))'): string {
  return `slot draft : ${decl}
slot log : Text = "start"
${body}
${tiles}
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
}

describe("a write through .get on a Some", () => {
  const SOURCE = app(
    "Option({title: Text, body: Text}) = None",
    `reducer seed on=app.start do= draft := Some({title: "a", body: "b"})
reducer edit on=ui.click(Btn) do= draft.get.title := "edited"`,
    'tile Btn = button(text="edit")\ntile App = column(Btn)',
  );

  it("edits the payload and leaves the tag alone", async () => {
    const shape = await loadSource(SOURCE);
    const report = await runScenario(shape, freshRoot(), {
      steps: [
        { expect: { state: { draft: { _tag: "Some", _0: { title: "a", body: "b" } } } } },
        { do: { dispatch: "edit" } },
      ],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
    expect(shape.live?.draft).toEqual({ _tag: "Some", _0: { title: "edited", body: "b" } });
  });
});

describe("a write through .get on a None", () => {
  const SOURCE = app(
    "Option({title: Text}) = None",
    `reducer edit on=ui.click(Btn) do=
        draft.get.title := "edited"
        log := "ran"`,
    'tile Btn = button(text="edit")\ntile App = column(Btn)',
  );

  it("changes nothing, panics on nothing, and lets the rest of the batch commit", async () => {
    const shape = await loadSource(SOURCE);
    const report = await runScenario(shape, freshRoot(), {
      steps: [{ do: { dispatch: "edit" }, expect: { noErrors: true } }],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
    expect(shape.live?.draft).toEqual({ _tag: "None" });
    expect(shape.live?.log).toBe("ran");
  });
});

describe("a record whose field is named get", () => {
  const SOURCE = app(
    '{get: {title: Text}} = {get: {title: "a"}}',
    `reducer edit on=ui.click(Btn) do= draft.get.title := "edited"`,
    'tile Btn = button(text="edit")\ntile App = column(Btn)',
  );

  it("is written as that field", async () => {
    const shape = await loadSource(SOURCE);
    await runScenario(shape, freshRoot(), { steps: [{ do: { dispatch: "edit" } }] });
    expect(shape.live?.draft).toEqual({ get: { title: "edited" } });
  });
});

describe("a write through .get on a Result", () => {
  const SOURCE = app(
    'Result({title: Text}, Text) = Err("none yet")',
    `reducer seedOk on=ui.click(Btn) do= draft := Ok({title: "a"})
reducer edit on=ui.click(Btn2) do= draft.get.title := "edited"`,
    'tile Btn = button(text="ok")\ntile Btn2 = button(text="edit")\ntile App = column(Btn, Btn2)',
  );

  it("edits an Ok payload and leaves an Err alone", async () => {
    const shape = await loadSource(SOURCE);
    await runScenario(shape, freshRoot(), {
      steps: [{ do: { dispatch: "seedOk" } }, { do: { dispatch: "edit" } }],
    });
    expect(shape.live?.draft).toEqual({ _tag: "Ok", _0: { title: "edited" } });

    const errShape = await loadSource(
      app(
        'Result({title: Text}, Text) = Err("none yet")',
        `reducer seedErr on=ui.click(Btn) do= draft := Err("nope")
reducer edit on=ui.click(Btn2) do= draft.get.title := "edited"`,
        'tile Btn = button(text="err")\ntile Btn2 = button(text="edit")\ntile App = column(Btn, Btn2)',
      ),
    );
    await runScenario(errShape, freshRoot(), {
      steps: [{ do: { dispatch: "seedErr" } }, { do: { dispatch: "edit" } }],
    });
    expect(errShape.live?.draft).toEqual({ _tag: "Err", _0: "nope" });
  });
});

describe("a bind= path through .get", () => {
  const SOURCE = app(
    "Option({title: Text}) = None",
    `reducer seed on=app.start do= draft := Some({title: "a"})`,
    'tile App = column(input(bind=draft.get.title, id="t"))',
  );

  it("panics while the Option is empty, the way every other .get read does", async () => {
    const shape = await loadSource(
      app("Option({title: Text}) = None", "", "tile App = column(input(bind=draft.get.title))"),
    );
    const report = await runScenario(shape, freshRoot(), {
      steps: [{ expect: { noErrors: true } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps.flatMap((st) => st.errors).join(" ")).toContain("get called on None");
  });

  it("reads the payload and writes back into it", async () => {
    const shape = await loadSource(SOURCE);
    const root = freshRoot();
    const report = await runScenario(shape, root, {
      steps: [{ do: { fill: "#t", value: "edited" } }],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
    expect(shape.live?.draft).toEqual({ _tag: "Some", _0: { title: "edited" } });
  });
});
