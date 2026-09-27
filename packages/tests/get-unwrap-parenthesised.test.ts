// stdlib.md §2.2.4 / §2.2.5 declare `get : T` on `Option` and `Result` — the
// polymorphic unwrap — and §2.2.3's parenthesis-free shortcut makes `o.get` an
// alternative spelling of `o.get()`, not a different member.
//
// The checker has accepted `o.get()` since `.get`'s arity became receiver-
// decided, but the lowering only knew the keyed reading, `Map.get(k)` /
// `List.get(i)`, and read an argument the call did not have: `check` said ok,
// then `build` and `smoke` died with a bare `TypeError` naming no file or line.
// The checker's side of the agreement is walked method by method in
// `packages/compiler/test/method-check-build-agree.test.ts`; this file pins what
// the built app does.

import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

function freshRoot(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

const app = (decl: string, write: string): string => `${decl}
reducer bump on=ui.click(Go) do=
    v := ${write}
tile Go = button(text="go")
tile App = column(Go)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

describe("o.get() / r.get() unwrap, the same member as the paren-free .get", () => {
  it.each([
    ["an Option", "slot v : Option(Int) = Some(5)", "Some(v.get() + 1)", { _tag: "Some", _0: 6 }],
    ["a Result", "slot v : Result(Int, Text) = Ok(5)", "Ok(v.get() + 1)", { _tag: "Ok", _0: 6 }],
  ])("builds, and unwraps %s", async (_label, decl, write, after) => {
    const shape = await loadSource(app(decl, write));
    const report = await runScenario(shape, freshRoot(), {
      steps: [{ do: { dispatch: "bump" }, expect: { noErrors: true } }],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
    expect(shape.live?.v).toEqual(after);
  });

  // "Panics exactly like `.get`": the same reducer written in each spelling,
  // run on the empty case, has to end the same way — an error reported and
  // the write rolled back.
  it.each([
    ["None", "slot v : Option(Int) = None", "Some", { _tag: "None" }],
    ["Err", 'slot v : Result(Int, Text) = Err("e")', "Ok", { _tag: "Err", _0: "e" }],
  ])("on %s, panics exactly as .get does", async (_label, decl, wrap, before) => {
    const outcomes = [];
    for (const get of ["v.get()", "v.get"]) {
      const shape = await loadSource(app(decl, `${wrap}(${get} + 1)`));
      const report = await runScenario(shape, freshRoot(), {
        steps: [{ do: { dispatch: "bump" } }],
      });
      outcomes.push({ errors: report.steps.flatMap((s) => s.errors).length > 0, v: shape.live?.v });
    }
    expect(outcomes[0]).toEqual({ errors: true, v: before });
    expect(outcomes[1]).toEqual(outcomes[0]);
  });

  // The reading the checker accepts `.get()` for on a receiver it cannot
  // decide is the unwrap: a call with no key has nothing to look up. `$el` is
  // untyped, and the unwrap hands a plain value back unchanged.
  it("reads .get() on an undecided receiver as the unwrap, not the lookup", async () => {
    const src = app('slot v : Text = ""', "$el.x.get()").replace(
      'tile Go = button(text="go")',
      'tile Go = button(text="go") {id: "go", x: "picked"}',
    );
    const shape = await loadSource(src);
    const report = await runScenario(shape, freshRoot(), {
      steps: [{ do: { click: "#go" }, expect: { noErrors: true, state: { v: "picked" } } }],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  });
});
