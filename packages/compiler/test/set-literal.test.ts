// A list literal where a `Set` is declared is built as a Set (stdlib.md
// §2.2.2): the checker marks it (`asSet`) wherever it checks a value against a
// Set type, and codegen lowers a marked literal to `_s.setOf`. The runtime
// half, and every member reading the result, is pinned in
// `packages/tests/set-literal.test.ts`; this pins the decision.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string): string =>
  `${defs}\ntile Btn = button(text="go")\ntile App = column(Btn)\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

function js(defs: string): string {
  const r = compile(app(defs), { runtimeSpecifier: "./runtime.js" });
  if (r.kind !== "ok") throw new Error(r.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
  return r.js;
}

describe("a list literal checked against a Set type", () => {
  it("lowers to setOf in a slot, a record field, a reducer write and a Set operand, and nowhere a List is declared", () => {
    const out = js(`type Bag = {tags: Set(Text)}
slot s   : Set(Int)  = [5]
slot xs  : List(Int) = [6]
slot bag : Bag       = {tags: ["x"]}
slot w   : Set(Text) = []
reducer go on=ui.click(Btn) do= w := w.union(["a"])`);
    expect(out).toContain("_s.setOf([5])");
    expect(out).toContain('_s.setOf(["x"])');
    expect(out).toContain('_s.setOf(["a"])');
    expect(out).not.toContain("_s.setOf([6])");
  });
});

describe("a Set operand", () => {
  it("is another Set of the receiver's type, so a List there is E0201", () => {
    const codes = check(
      parse(
        lex(
          app(`slot w  : Set(Text)  = []
slot xs : List(Text) = []
reducer go on=ui.click(Btn) do= w := w.union(xs)`),
        ),
      ),
    ).map((e) => e.code);
    expect(codes).toContain("E0201");
  });
});
