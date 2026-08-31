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
const appWith = (defs: string, init: string) => `slot n : Int = 0
slot key : Text = "k"
effect load  cap=storage.read in=Text     out=Result(Text, Text)
effect probe cap=storage.read in=Route    out=Result(Text, Text)
effect note  cap=log.write    in=EffectId out=Unit
reducer got on=load.ok(_, _) do= n := 1
${defs}
tile App = column(text(n.show))
app A caps=[storage.read, log.write] routes={"/" -> App, "/404" -> App} init=[${init}]
`;

const app = (init: string) => appWith("", init);

const diagnostics = (init: string) => check(parse(lex(app(init))));
const codes = (init: string) => diagnostics(init).map((e) => e.code);
const codesWith = (defs: string, init: string) =>
  check(parse(lex(appWith(defs, init)))).map((e) => e.code);

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

  it("leaves a local bind of the same name alone", () => {
    // Shadowing is legal, and codegen honours it — `localBinds` is the first
    // thing its `Ref` case consults, before the built-in. A gate that looked at
    // the spelling alone would reject a program that compiles and runs.
    expect(codes('load(let route = "x" in route)')).toEqual([]);
    expect(codes("load(match key with | route -> route)")).toEqual([]);
  });

  it("lowers a shadowed read to the binding, not to the runtime's route", () => {
    const result = compile(app('load(let route = "x" in route)'), {
      runtimeSpecifier: "./runtime.js",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const init = result.js.split(/\r?\n/).find((l) => l.includes("init: ["));
    expect(init).toBeDefined();
    expect(init).not.toContain('_live["route"]');
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
    // Not the reducer-scope lowering, which reads a pending write first: there
    // is no reducer frame around this, and the checker now agrees with that.
    expect(result.js).not.toContain('init: [{ effect: "load", args: [((_next');
  });

  it("captures `now` at construction too, which is the whole point of the rule", () => {
    // `now` is the other name the runtime answers, and it is fine here only
    // because `_s` is a module import rather than something a mount installs.
    // Pinned because "fine" is a property of where it comes from, not of the
    // name: if it ever moved onto the app the way `route` did, this position
    // would go back to capturing `undefined` with `check` clean.
    const result = compile(app("load(now.show)"), { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const init = result.js.split(/\r?\n/).find((l) => l.includes("init: ["));
    expect(init).toContain("_s.now()");
  });
});

describe("route reached through a fn call in an app.init argument", () => {
  // `route` in a `fn` body is legal and stays legal: the `fn` is not in the
  // slot table, so the purity check does not see it, and every other caller —
  // a tile, a reducer, an effect's `map-request` — runs after the mount that
  // installs it. What cannot stand is the call from `app.init`, and nothing in
  // that position knows what the callee reads.
  //
  // The hop was worse than the direct read it replaces: a direct `route.path`
  // throws at mount, while `function here() { return (_live["route"])["path"]; }`
  // reached from `init:` throws while the module is still being imported, so
  // nothing loads at all.

  it("is reported at the call, with the chain that reaches the route", () => {
    const errs = check(parse(lex(appWith("fn here() -> Text = route.path", "load(here())"))));
    expect(errs.map((e) => e.code)).toEqual(["E0120"]);
    expect(errs[0]?.message).toContain("here → route");
  });

  it("follows the chain through more than one hop", () => {
    const errs = check(
      parse(
        lex(
          appWith(
            `fn outer() -> Text = inner()
fn inner() -> Text = route.path`,
            "load(outer())",
          ),
        ),
      ),
    );
    expect(errs.map((e) => e.code)).toEqual(["E0120"]);
    expect(errs[0]?.message).toContain("outer → inner → route");
  });

  it("reports each call that reaches it, since each is its own fix", () => {
    expect(
      codesWith(
        `fn one() -> Text = route.path
fn two() -> Text = route.pattern`,
        "load(one() + two())",
      ),
    ).toEqual(["E0120", "E0120"]);
  });

  it("points at the call rather than at the argument that contains it", () => {
    // Two calls in one argument are two things to fix, so two reports at the
    // argument's own position would be indistinguishable.
    const errs = check(
      parse(
        lex(
          appWith(
            `fn one() -> Text = route.path
fn two() -> Text = route.pattern`,
            "load(one() + two())",
          ),
        ),
      ),
    );
    const columns = errs.map((e) => e.pos.col);
    expect(new Set(columns).size).toBe(2);
  });

  it("reports the direct read and the hop separately when both are written", () => {
    expect(codesWith("fn here() -> Text = route.path", "load(route.path + here())")).toEqual([
      "E0120",
      "E0120",
    ]);
  });

  it("leaves the same fn alone everywhere the route does exist", () => {
    // The narrowing this rule needs: a `fn` that reads the route is correct,
    // and only the init call site is wrong.
    const src = `slot n : Int = 0
effect load cap=storage.read in=Text out=Result(Text, Text)
fn here() -> Text = route.path
reducer go  on=ui.click(B) do= emit load(here())
reducer got on=load.ok(_, _) do= n := 1
tile B = button(text="go", onClick=go)
tile App = column(B, text(here()))
app A caps=[storage.read] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src)))).toEqual([]);
  });

  it("leaves a `map-request` that calls the same fn alone", () => {
    const src = `slot n : Int = 0
fn here() -> Text = route.path
effect load cap=storage.read in=Text out=Result(Text, Text) map-request={key: here()}
reducer got on=load.ok(_, _) do= n := 1
tile App = column(text(n.show))
app A caps=[storage.read] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src)))).toEqual([]);
  });

  it("honours a binding inside the fn that shadows the name", () => {
    // The discriminator against a walk that matches the spelling: both of
    // these compile and run, and rejecting them is the same checker/codegen
    // disagreement this gate exists to close, pointed the other way.
    expect(codesWith(`fn safe() -> Text = let route = "x" in route`, "load(safe())")).toEqual([]);
    expect(codesWith("fn tail(route: Text) -> Text = route", "load(tail(key))")).toEqual([]);
  });

  it("terminates on a cycle, and still reports the route it reaches", () => {
    // `E0006` rejects the cycle itself. This pass runs whether or not that
    // report is there, so it has to stop on its own.
    expect(
      codesWith(
        `fn a() -> Text = b()
fn b() -> Text = a() + route.path`,
        "load(a())",
      ).sort(),
    ).toEqual(["E0006", "E0120"]);
  });

  it("says nothing about a cycle that reaches no route", () => {
    expect(
      codesWith(
        `fn a() -> Text = b()
fn b() -> Text = a()`,
        "load(a())",
      ),
    ).toEqual(["E0006"]);
  });

  it("covers `$route` in the chain, which the fn's own report already rejects", () => {
    // `$route` in a `fn` body is E0103: there is no payload there to carry
    // one. The chain report stands beside it rather than instead of it — the
    // two name different mistakes, and the init call site is wrong even once
    // the `fn` is fixed to read the slot.
    expect(codesWith("fn here() -> Text = $route.path", "load(here())").sort()).toEqual([
      "E0103",
      "E0120",
    ]);
  });
});
