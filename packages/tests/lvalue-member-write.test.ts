import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string): string =>
  `${defs}\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

/** The reported program, verbatim in shape. */
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

  it("build refuses to emit it", () => {
    const r = compile(THE_REPRO, { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => e.code)).toContain("E0602");
  });

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

  it("still emits a File's structural field behind the unwrap", () => {
    const src = app(`slot f : Option(File) = None

reducer act on=ui.click(Btn)
    do= f.get.name := "x"

tile Btn = button(text="go")
tile App = column(Btn)`);
    const r = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    // The unwrap, then the field as a key — not two keys and not two unwraps.
    expect(r.js).toContain('[{"get":true}, "name"]');
  });

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
