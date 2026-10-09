import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string): string =>
  `${defs}\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

const body = (decls: string, call: string): string =>
  app(`${decls}
reducer act on=ui.click(Btn)
    do= sink := ${call}
tile Btn = button(text="go")
tile App = column(Btn)`);

const MAP = `slot m : Map(Text, Int) = {"k": 7}\nslot sink : Int = 0`;
const OPT = `slot o : Option(Int) = Some(5)\nslot sink : Int = 0`;

describe("the receiver decides .get-or's arity, and check and build agree", () => {
  it.each([
    ["the Option reading on a Map", MAP, `m.get-or("k")`],
    ["the Map reading on an Option", OPT, `o.get-or("k", 0)`],
  ])("check reports %s", (_label, decls, call) => {
    const codes = check(parse(lex(body(decls, call)))).map((e) => e.code);
    expect(codes).toContain("E0213");
  });

  it.each([
    ["the Option reading on a Map", MAP, `m.get-or("k")`],
    ["the Map reading on an Option", OPT, `o.get-or("k", 0)`],
  ])("build refuses to emit %s", (_label, decls, call) => {
    const r = compile(body(decls, call), { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => e.code)).toContain("E0213");
  });

  it("check and build both refuse a third argument on a receiver they cannot decide", () => {
    const src = body(`slot sink : Int = 0`, `$event.get-or("k", 0, 99)`);
    expect(check(parse(lex(src))).map((e) => e.code)).toContain("E0213");
    const r = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => e.code)).toContain("E0213");
  });

  it("still lowers the Map reading to mapGetOr", () => {
    const r = compile(body(MAP, `m.get-or("k", 0)`), { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.js).toContain("_s.mapGetOr(");
    expect(r.js).not.toContain("_s.getOr(");
  });

  it("still lowers the Option reading to getOr", () => {
    const r = compile(body(OPT, `o.get-or(0)`), { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.js).toContain("_s.getOr(");
    expect(r.js).not.toContain("_s.mapGetOr(");
  });
});
