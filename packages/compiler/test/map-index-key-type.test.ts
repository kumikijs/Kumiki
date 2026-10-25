import { readFileSync } from "node:fs";
import { compile } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { checkSource, codesOf, locatedOf, textAt } from "./helpers/diagnostics.ts";

const SRC = readFileSync(feature("212-map-index-key-type"), "utf8");

/** The example with `written`, which it holds once, replaced by `wrong`. */
function respelled(written: string, wrong: string): string {
  expect(SRC.split(written), `"${written}" is written once`).toHaveLength(2);
  return SRC.replace(written, wrong);
}

describe("the index of a Map(K, V) is a K", () => {
  it("leaves the example's own keys alone", () => {
    expect(codesOf(SRC)).toEqual([]);
  });

  it.each([
    ["a read", "shown := notes[todo]", "shown := notes[post]", "post", "TodoId", "PostId"],
    ["a write", 'notes[todo] := "edited"', 'notes[post] := "edited"', "post", "TodoId", "PostId"],
    [
      "a write through the entry",
      "todos[todo].done := true",
      "todos[post].done := true",
      "post",
      "TodoId",
      "PostId",
    ],
    [
      "a read in a tile",
      '"t1: " + notes[todo]',
      '"t1: " + notes[post]',
      "post",
      "TodoId",
      "PostId",
    ],
    ["a read of a Text-keyed Map", 'counts["a"] + 1', "counts[1] + 1", "1", "Text", "Int"],
    [
      "a write into a Text-keyed Map",
      'counts["a"] := counts',
      "counts[1] := counts",
      "1",
      "Text",
      "Int",
    ],
  ])("refuses another key type in %s, by check and by build", (_what, written, wrong, key, k, got) => {
    const src = respelled(written, wrong);
    const errs = checkSource(src);
    expect(errs.map((e) => e.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe(`Expected ${k} but got ${got}`);
    expect(textAt(src, defined(errs[0], "the E0201").pos).startsWith(`${key}]`)).toBe(true);
    const built = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(built.kind).toBe("fail");
    if (built.kind !== "fail") return;
    expect(built.errors.map((e) => e.code)).toEqual(["E0201"]);
  });
});

describe("the keys of a nested Map index", () => {
  const NESTED = `type TodoId = nominal Text
type PostId = nominal Text
slot mm : Map(TodoId, Map(PostId, Int)) = {}
slot post : PostId = "p"
slot todo : TodoId = "t"
slot n : Int = 0
reducer go on=ui.click(Btn) do= STATEMENT
tile Btn = button(text="go", onClick=go)
tile Home = column(Btn)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]`;

  it.each([
    ["a read", "n := mm[post][todo]"],
    ["a write", "mm[post][todo] := 1"],
  ])("are each E0201 at the key, in source order, in %s", (_what, statement) => {
    const src = NESTED.replace("STATEMENT", statement);
    const found = locatedOf(src);
    expect(found.map((d) => [d.code, d.message])).toEqual([
      ["E0201", "Expected TodoId but got PostId"],
      ["E0201", "Expected PostId but got TodoId"],
    ]);
    expect(found.map((d) => textAt(src, d).slice(0, 5))).toEqual(["post]", "todo]"]);
  });
});

describe("a Map whose key type names nothing", () => {
  it("is E0117 at the type, and its index is not judged against it", () => {
    const src = `slot m : Map(Foo(Int), Int) = {}
slot n : Int = 0
reducer go on=ui.click(Btn) do= n := m[1]
tile Btn = button(text="go", onClick=go)
tile Home = column(Btn)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(codesOf(src)).toEqual(["E0117"]);
  });
});
