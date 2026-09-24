// A `Set` is stored as `{ [key]: true }` and a `Map` as a plain object, so at
// runtime their keys are JavaScript object keys — strings. The three readers
// that hand keys back (`Set(T).to-list`, `Map(K, V).keys`, `Map(K, V).entries`,
// stdlib.md §2.2.1 / §2.2.2) are typed with the declared key type, so the
// checker records how that type reads back and codegen passes it along. Without
// it a `Set(Int)` read back `["7", "8"]` under a `List(Int)` type.
//
// What is pinned here is the lowering: the kind a reader is handed for each
// declared key type, on both spellings (`st.to-list` and `st.to-list()`), and
// nothing on a key that is already a string. The runtime's side is in
// `packages/runtime/test/stdlib.test.ts`, and example 102 runs the two together.

import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string): string =>
  `${defs}\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

/** The emitted module for one reducer that writes `rhs` into `res`. */
function jsFor(decls: string, resType: string, rhs: string): string {
  const src = app(`${decls}
slot res : ${resType} = []
reducer act on=ui.click(Btn)
    do= res := ${rhs}
tile Btn = button(text="go")
tile App = column(Btn)`);
  const r = compile(src, { runtimeSpecifier: "./runtime.js" });
  if (r.kind !== "ok") throw new Error(r.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
  return r.js;
}

/**
 * `_s.<helper>(<read of slot>)` or `_s.<helper>(<read of slot>, "<kind>")`. A
 * reducer reads a slot as `((_next[s] !== undefined) ? _next[s] : _live[s])`,
 * so the match is anchored on the helper and on what follows the read.
 */
const lowered = (helper: string, slot: string, kind?: string): RegExp =>
  new RegExp(
    `_s\\.${helper}\\(\\(\\(_next\\["${slot}"\\] !== undefined\\) \\? _next\\["${slot}"\\] : _live\\["${slot}"\\]\\)${kind ? `, "${kind}"` : ""}\\)`,
  );

describe("a reader of a numeric key is told to read numbers", () => {
  it.each([
    ["Set(Int)", "st.to-list", "List(Int)"],
    ["Set(Int)", "st.to-list()", "List(Int)"],
    ["Set(Float)", "st.to-list", "List(Float)"],
  ])("%s / %s", (setType, rhs, resType) => {
    expect(jsFor(`slot st : ${setType} = {}`, resType, rhs)).toMatch(
      lowered("toList", "st", "number"),
    );
  });

  it.each(["m.keys", "m.keys()"])("Map(Int, Text) / %s", (rhs) => {
    expect(jsFor(`slot m : Map(Int, Text) = {}`, "List(Int)", rhs)).toMatch(
      lowered("mapKeys", "m", "number"),
    );
  });

  it("Map(Int, Text) / m.entries", () => {
    expect(jsFor(`slot m : Map(Int, Text) = {}`, "List(Tuple(Int, Text))", "m.entries")).toMatch(
      lowered("mapEntries", "m", "number"),
    );
  });

  // The kind is the key type's *representation*, so a name over a number reads
  // a number back — the declared type is followed through the nominal.
  it("follows a nominal over Int", () => {
    const js = jsFor(
      `type TaskId = nominal Int\nslot st : Set(TaskId) = {}`,
      "List(TaskId)",
      "st.to-list",
    );
    expect(js).toMatch(lowered("toList", "st", "number"));
  });
});

describe("a reader of a Bool key is told to read booleans", () => {
  it("Set(Bool) / st.to-list", () => {
    expect(jsFor(`slot st : Set(Bool) = {}`, "List(Bool)", "st.to-list")).toMatch(
      lowered("toList", "st", "bool"),
    );
  });
});

describe("a Text key needs nothing", () => {
  it("Map(Text, Int) / m.keys lowers without a kind", () => {
    expect(jsFor(`slot m : Map(Text, Int) = {}`, "List(Text)", "m.keys")).toMatch(
      lowered("mapKeys", "m"),
    );
  });

  it("Set(Text) / st.to-list lowers without a kind", () => {
    expect(jsFor(`slot st : Set(Text) = {}`, "List(Text)", "st.to-list")).toMatch(
      lowered("toList", "st"),
    );
  });

  // An Option's `to-list` shares the name and the helper, and has no key.
  it("Option(Int) / o.to-list lowers without a kind", () => {
    expect(jsFor(`slot o : Option(Int) = None`, "List(Int)", "o.to-list")).toMatch(
      lowered("toList", "o"),
    );
  });
});
