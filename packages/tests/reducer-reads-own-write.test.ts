// A slot read inside a reducer body sees what the body has already written,
// whatever nested form it sits in. Each nested form opens a scope of its own,
// and every lowering that rebuilt the scope without the reducer's view of the
// slots lowered the read to `_live[...]` — the value from before the click.
// Each row below writes `noteKey := "b"` and then reads it in one position; a
// tile's `match` is the control, where the read has to stay on `_live`.

import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

/** A program whose `go` reducer writes `noteKey := "b"` and then `got := <read>`. */
function program(read: string, outType = "Text", outInit = '""'): string {
  return `type Shape = Circle(Int) | Square(Int)
slot noteKey : Text       = "a"
slot names   : List(Text) = ["b", "b", "c"]
slot shape   : Shape      = Circle(1)
slot got     : ${outType} = ${outInit}
reducer go on=ui.click(Go) do= noteKey := "b"
                               got := ${read}
tile Go = button(text="go", onClick=go)
tile App = column(Go, text("got=" + got.show))
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
}

/** Mount `source`, click `go` once, and return the slots. */
async function clickOnce(source: string): Promise<Record<string, unknown>> {
  const app = await loadSource(source);
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    const { dispose } = mount(app, root);
    root.querySelector("button")?.click();
    const slots = { ...(app.live ?? {}) };
    dispose();
    return slots;
  } finally {
    root.remove();
  }
}

describe("a slot read after the reducer's own write, in a nested form", () => {
  it.each([
    ["a match binding arm", "match 1 with | n -> noteKey"],
    ["a match variant arm", "match shape with | Circle(r) -> noteKey | Square(s) -> noteKey"],
    ["a match tuple arm", 'match ("x", 1) with | (s, _) -> noteKey'],
    ["a let … in body", 'let k = "x" in noteKey'],
  ])("reads the write in %s", async (_row, read) => {
    const slots = await clickOnce(program(read));
    expect(slots.noteKey).toBe("b");
    expect(slots.got).toBe("b");
  });

  it("reads the write in a method predicate", async () => {
    // Before the fix the receiver saw the write and the predicate did not:
    // `$1 == "a"` over ["b", "b", "c"] counts 0.
    const slots = await clickOnce(program("names.filter($1 == noteKey).size", "Int", "0"));
    expect(slots.got).toBe(2);
  });

  it("reads the write in a method's element lambda", async () => {
    const slots = await clickOnce(program('names.map($1 + noteKey).join(",")'));
    expect(slots.got).toBe("bb,bb,cb");
  });
});

describe("a tile's nested forms still read the live slots", () => {
  // A tile renders outside every reducer body, where `_next` is not declared,
  // so a nested scope there must keep reading `_live`: a `_next` read would be
  // a ReferenceError at render.
  it("renders a tile match arm and let body that read a slot", async () => {
    const source = `type Shape = Circle(Int) | Square(Int)
slot noteKey : Text  = "a"
slot shape   : Shape = Circle(1)
reducer flip on=ui.click(Flip) do= shape := Square(2)
                                   noteKey := "z"
tile Flip = button(text="flip", onClick=flip)
tile Body = match shape with
    | Circle(r) -> text("circle=" + noteKey)
    | Square(s) -> text(let k = "x" in "square=" + noteKey)
tile App = column(Flip, Body)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    const app = await loadSource(source);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      expect(root.textContent).toContain("circle=a");
      root.querySelector("button")?.click();
      expect(root.textContent).toContain("square=z");
      dispose();
    } finally {
      root.remove();
    }
  });
});
