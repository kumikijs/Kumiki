// `docs/spec/language.md` §1.6.3 gives the lvalue step set, and it is closed:
// a field, an index, and `.get` on an Option / Result. A stdlib member is not
// a step.
//
// It used to be accepted as one. The lvalue was flattened into a plain field
// path, so the member name became a literal key and the write replaced the
// slot with a record: `name` declared `Text` ended up holding `{"length": 9}`.
// `check` said `ok`, `build` emitted it, and the first thing to notice was a
// render tripping over a value of the wrong shape.
//
// The checker's own cases are in `packages/compiler/test/lvalue-members.test.ts`.
// What this file pins is that the two verbs agree: a program `check` rejects is
// a program `build` refuses to emit, so the defect cannot come back through
// codegen alone. It also holds the boundary from the other side — the writes
// that must keep working are the ones `96-shortcut-named-fields` exercises.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string): string =>
  `${defs}\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

/** The issue's own program (#370), verbatim in shape. */
const THE_REPRO = app(`slot name  : Text         = "abc"
slot maybe : Option(Text) = None

reducer bad on=ui.click(Btn)
    do= name.length := 9
        maybe.is-some := 0

tile Btn = button(text="go")
tile App = column(Btn, text("name: " + name))`);

describe("a member is not an lvalue, and check and build agree about it", () => {
  it("check reports both writes, naming the member and the receiver", () => {
    const errs = check(parse(lex(THE_REPRO)));
    const reported = errs.filter((e) => e.code === "E0602");
    expect(reported).toHaveLength(2);
    expect(reported.map((e) => e.message).join("\n")).toContain('".length"');
    expect(reported.map((e) => e.message).join("\n")).toContain('".is-some"');
    expect(reported.map((e) => e.message).join("\n")).toContain('"Text"');
  });

  // The half that makes the fix hold: `build` shares the checker, so a program
  // that reports cannot be emitted. Before, the same source produced JS whose
  // setter wrote the member name as a key.
  it("build refuses to emit it", () => {
    const r = compile(THE_REPRO, { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => e.code)).toContain("E0602");
  });

  // The rule has to refuse members without refusing fields that share their
  // names — otherwise it would report working programs, which is the more
  // expensive direction.
  it("still emits a write to a record field named like a member", () => {
    const src = app(`type Ruler = { length: Int, get: Text }
slot ruler : Ruler = {length: 0, get: "held"}

reducer measure on=ui.click(Btn)
    do= ruler.length := 1
        ruler.get := "taken"

tile Btn = button(text="go")
tile App = column(Btn, text(ruler.length.show + ruler.get))`);
    const r = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    // Both segments are keys, and neither is the unwrap datum.
    expect(r.js).toContain('"length"');
    expect(r.js).toContain('"get"');
    expect(r.js).not.toContain('{"get":true}');
  });

  // §1.6.3's one exception, which must stay an exception.
  it("still emits the unwrap for .get on an Option", () => {
    const src = app(`slot draft : Option({title: Text}) = None

reducer touch on=ui.click(Btn)
    do= draft.get.title := "x"

tile Btn = button(text="go")
tile App = column(Btn)`);
    const r = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.js).toContain('{"get":true}');
  });
});
