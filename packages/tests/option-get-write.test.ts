// `docs/spec/language.md` §1.6.3 documents assignment through `.get`:
//
//   Going via `.get` is safe: assigning when the Option is `None` is a no-op
//   (does not panic).
//
// It was not a write at all when the Option was `Some` either. The lvalue was
// flattened into a plain field path, so `draft.get.title := v` lowered to a
// record set of `["get", "title"]` — a sibling field named `get` appeared
// beside `_tag` / `_0`, and the payload the program then read was untouched.
//
// The read side has always lowered `.get` through the polymorphic unwrap,
// which is why the same path reads correctly and wrote wrong. These tests hold
// the two sides to the same decision — including the case that makes it a
// decision rather than a keyword: a record whose field is literally `get`.
//
// This file is where the regression is pinned, not the example's scenario: a
// scenario's `state` is a subset match, and the defect was an EXTRA key. The
// scenario tier structurally cannot see one, whatever the app renders.

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
    // Asserted as the whole value rather than through a partial match: the
    // defect was an EXTRA key, which a partial match cannot see.
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
    // §10.3.3 makes a reducer one batch; a no-op write is not a rejected one.
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
    // The name is dispatched, not reserved (stdlib.md §2.2): the read side
    // resolves it as a field when the receiver is a record that has it, and
    // the write side has to make the same call.
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
    // A decision this makes rather than inherits: the reader used to walk the
    // path with `?? {}` and hand the control an empty string, so a `bind=`
    // through `.get` was the one place `.get` did not mean `.get`. It panics
    // now — during the first render, so the app does not mount at all — and
    // an author reaches such a control through a `match` on the Option.
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
    // `bind=` goes through its own path builder and its own setter, so the two
    // ways to write a slot can disagree — and did, in the same direction.
    const shape = await loadSource(SOURCE);
    const root = freshRoot();
    const report = await runScenario(shape, root, {
      steps: [{ do: { fill: "#t", value: "edited" } }],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
    expect(shape.live?.draft).toEqual({ _tag: "Some", _0: { title: "edited" } });
  });
});
