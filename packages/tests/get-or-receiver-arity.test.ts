// `.get-or` has two readings told apart by the argument count — `Option(T)` /
// `Result(T, E)` take a default alone, a `Map(K, V)` takes a key and a default
// (stdlib.md §2.2.1 / §2.2.4). The count selects the lowering, so a count that
// did not fit its receiver lowered to the *other* reading and produced an
// answer that looked plausible:
//
//   m.get-or("k")      → `_s.getOr(m, "k")`; a Map carries no `_tag`, so the
//                        helper's last line hands back the whole map
//   opt.get-or("k", 0) → `_s.mapGetOr(opt, "k", 0)`; the Option object has no
//                        such key, so the fallback is the answer on a `Some`
//
// The checker's own cases are in
// `packages/compiler/test/get-or-receiver-arity.test.ts`. What this file pins
// is that the two verbs agree — a program `check` rejects is one `build`
// refuses to emit, so the defect cannot come back through codegen alone — and
// that the two readings still lower to their own helpers, which is the half a
// rejection cannot show.

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

  // A count past both readings needs no receiver: neither reading takes more
  // than two, and the lowering reads exactly two and drops the rest — so an
  // unreported third argument is this same defect under another name. This is
  // the one shape the check reports without knowing the receiver, which is why
  // it is pinned through `build` as well.
  it("check and build both refuse a third argument on a receiver they cannot decide", () => {
    const src = body(`slot sink : Int = 0`, `$event.get-or("k", 0, 99)`);
    expect(check(parse(lex(src))).map((e) => e.code)).toContain("E0213");
    const r = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => e.code)).toContain("E0213");
  });

  // The half a rejection cannot show: each legal reading still reaches its own
  // helper. Asserting the helper rather than "it compiles" is the point — the
  // defect was precisely that the wrong helper was reached, and both spellings
  // compiled either way.
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
