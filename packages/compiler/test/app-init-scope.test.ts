// `app.init` arguments are evaluated once, while `createApp()` is building the
// app object — before `mountCore` runs. Two things follow, and neither was
// checked:
//
//   * `route` does not exist yet. The runtime installs `app.live.route` during
//     the mount, so an argument reading it lowered to `_live["route"]` and got
//     `undefined`: `init = [load(route.path)]` compiled clean and threw
//     `Cannot read properties of undefined (reading 'path')` at mount.
//   * There is no reducer around the expression. The checker walked init
//     arguments in a reducer scope while codegen lowered them in the plain one,
//     so an `emit` expression passed the check and lowered to `_emits.push(…)`
//     inside the app object literal — `_emits` is local to a reducer body, so
//     the module threw `ReferenceError: _emits is not defined` at *import* and
//     nothing mounted at all.
//
// The scope the checker uses is now the one codegen lowers in, which is what
// makes the second case an ordinary purity report rather than a special case.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compile.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { check } from "../src/typecheck.ts";

/**
 * An app whose init list is the parameter. `load` takes the shape most init
 * entries have (a key, a path); `probe` takes a whole `Route` so a bare `route`
 * can be written without a type error masking the report under test; `note`
 * takes an `EffectId` so an `emit` expression is well-typed in that position.
 */
const app = (init: string) => `slot n : Int = 0
slot key : Text = "k"
effect load  cap=storage.read in=Text     out=Result(Text, Text)
effect probe cap=storage.read in=Route    out=Result(Text, Text)
effect note  cap=log.write    in=EffectId out=Unit
reducer got on=load.ok(_, _) do= n := 1
tile App = column(text(n.show))
app A caps=[storage.read, log.write] routes={"/" -> App, "/404" -> App} init=[${init}]
`;

const diagnostics = (init: string) => check(parse(lex(app(init))));
const codes = (init: string) => diagnostics(init).map((e) => e.code);

describe("route in an app.init argument", () => {
  it("is reported, and only once", () => {
    // A cascade would bury the one report that says what to do: the argument
    // still has to typecheck, and `undefined` has no type to blame.
    expect(codes("load(route.path)")).toEqual(["E0120"]);
  });

  it("is reported for the bare slot, not only for a field read off it", () => {
    expect(codes("probe(route)")).toEqual(["E0120"]);
  });

  it("is reported wherever in the argument it appears", () => {
    // `checkExpr` recurses, so nesting is covered by construction — but a
    // future implementation that only looked at the argument's head would pass
    // every other test in this file.
    expect(codes('load(if n == 0 then route.path else "x")')).toEqual(["E0120"]);
    expect(codes('load(fmt("{0}", route.path))')).toEqual(["E0120"]);
  });

  it("names the timing and where the route can be read instead", () => {
    const [error] = diagnostics("load(route.path)");
    expect(error?.kind).toBe("route-in-app-init");
    expect(error?.message).toContain("route.enter");
  });

  it("covers `$route`, which is no more available here", () => {
    // Outside init this is E0119, whose text tells the author to read the
    // `route` slot instead — advice that would walk them straight into the
    // report above. One answer for both spellings in this position.
    expect(codes("load($route.path)")).toEqual(["E0120"]);
  });

  it("leaves a slot read alone, which is what an init argument is for", () => {
    expect(codes("load(key)")).toEqual([]);
  });

  it("leaves `route` alone everywhere it does exist", () => {
    const src = `slot n : Int = 0
fn pathOf(r: Route) -> Text = r.path
tile App = column(text(pathOf(route)))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src)))).toEqual([]);
  });
});

describe("an emit expression in an app.init argument", () => {
  it("is reported as the impurity it is", () => {
    expect(codes('note(emit load("k"))')).toEqual(["E0305"]);
  });

  it("does not reach codegen, where it lowered to a reducer-local binding", () => {
    // The pre-fix emission put `_emits.push(...)` into the app object literal.
    // `_emits` is declared inside each reducer's generated body, so the module
    // threw at import and no tier below `check` ever ran.
    const result = compile(app('note(emit load("k"))'), { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors.map((e) => e.code)).toEqual(["E0305"]);
  });

  it("still accepts an emit expression inside a reducer", () => {
    const src = `slot n : Int = 0
effect load cap=storage.read in=Text out=Result(Text, Text)
effect note cap=log.write in=EffectId out=Unit
reducer go  on=app.start do= emit note(emit load("k"))
reducer got on=load.ok(_, _) do= n := 1
tile App = column(text(n.show))
app A caps=[storage.read, log.write] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src)))).toEqual([]);
  });
});

describe("what a valid app.init lowers to", () => {
  it("evaluates its arguments against the slot defaults, once", () => {
    const result = compile(app("load(key)"), { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('init: [{ effect: "load", args: [_live["key"]] }]');
    // Not `_next[…] ?? _live[…]`: there is no reducer frame around this, and
    // the checker now agrees with that.
    expect(result.js).not.toContain('init: [{ effect: "load", args: [((_next');
  });
});
