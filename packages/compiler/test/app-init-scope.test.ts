import { describe, expect, it } from "vitest";
import { compile } from "../src/compile.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { check } from "../src/typecheck.ts";

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

const callPosition = (src: string, call: string): { line: number; col: number } => {
  const lines = src.split("\n");
  const line = lines.findIndex((l) => l.startsWith("app A"));
  const col = (lines[line] ?? "").indexOf(call);
  if (line < 0 || col < 0) throw new Error(`"${call}" is not in the app line`);
  return { line: line + 1, col: col + 1 };
};

const diagnostics = (init: string) => check(parse(lex(app(init))));
const codes = (init: string) => diagnostics(init).map((e) => e.code);
const codesWith = (defs: string, init: string) =>
  check(parse(lex(appWith(defs, init)))).map((e) => e.code);

describe("route in an app.init argument", () => {
  it("is reported, and only once", () => {
    expect(codes("load(route.path)")).toEqual(["E0120"]);
  });

  it("is reported for the bare slot, not only for a field read off it", () => {
    expect(codes("probe(route)")).toEqual(["E0120"]);
  });

  it("is reported wherever in the argument it appears", () => {
    expect(codes('load(if n == 0 then route.path else "x")')).toEqual(["E0120"]);
    expect(codes('load(fmt("{0}", route.path))')).toEqual(["E0120"]);
  });

  it("names the timing and where the route can be read instead", () => {
    const [error] = diagnostics("load(route.path)");
    expect(error?.kind).toBe("route-in-app-init");
    expect(error?.message).toContain("route.enter");
  });

  it("covers `$route`, which is no more available here", () => {
    expect(codes("load($route.path)")).toEqual(["E0120"]);
  });

  it("leaves a slot read alone, which is what an init argument is for", () => {
    expect(codes("load(key)")).toEqual([]);
  });

  it("leaves a local bind of the same name alone", () => {
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
    expect(result.js).not.toContain('init: [{ effect: "load", args: [((_next');
  });

  it("captures `now` at construction too, which is the whole point of the rule", () => {
    const result = compile(app("load(now.show)"), { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const init = result.js.split(/\r?\n/).find((l) => l.includes("init: ["));
    expect(init).toContain("_s.now()");
  });
});

describe("route reached through a fn call in an app.init argument", () => {
  it("is reported at the call, with the chain that reaches the route", () => {
    const errs = check(parse(lex(appWith("fn here() -> Text = route.path", "load(here())"))));
    expect(errs.map((e) => e.code)).toEqual(["E0120"]);
    expect(errs[0]?.message).toContain("here → route");
  });

  it("follows the chain through more than one hop", () => {
    const src = appWith(
      `fn outer() -> Text = inner()
fn inner() -> Text = route.path`,
      "load(outer())",
    );
    const errs = check(parse(lex(src)));
    expect(errs.map((e) => e.code)).toEqual(["E0120"]);
    expect(errs[0]?.message).toContain("outer → inner → route");
    expect(errs[0]?.pos).toEqual(callPosition(src, "outer()"));
  });

  it("names the whole chain, not its ends, however long it is", () => {
    const errs = check(
      parse(
        lex(
          appWith(
            `fn a() -> Text = b()
fn b() -> Text = c()
fn c() -> Text = d()
fn d() -> Text = route.path`,
            "load(a())",
          ),
        ),
      ),
    );
    expect(errs[0]?.message).toContain("a → b → c → d → route");
  });

  it("reports one fn reached from two separate init entries, twice", () => {
    expect(codesWith("fn here() -> Text = route.path", "load(here()), load(here())")).toEqual([
      "E0120",
      "E0120",
    ]);
  });

  it("finds a call nested inside another call's argument", () => {
    const src = appWith(
      `fn wrap(t: Text) -> Text = t
fn inner() -> Text = route.path`,
      "load(wrap(inner()))",
    );
    const errs = check(parse(lex(src)));
    expect(errs.map((e) => e.code)).toEqual(["E0120"]);
    expect(errs[0]?.pos).toEqual(callPosition(src, "inner()"));
  });

  it("finds a read nested inside the fn's own scopes", () => {
    expect(
      codesWith(
        `fn nested() -> Text = let a = "x" in let b = "y" in route.path + a + b`,
        "load(nested())",
      ),
    ).toEqual(["E0120"]);
    expect(
      codesWith(
        "fn armed(t: Text) -> Text = match t with | k -> route.path + k",
        "load(armed(key))",
      ),
    ).toEqual(["E0120"]);
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
    const src = appWith(
      `fn one() -> Text = route.path
fn two() -> Text = route.pattern`,
      "load(one() + two())",
    );
    const errs = check(parse(lex(src)));
    expect(errs.map((e) => e.pos)).toEqual([
      callPosition(src, "one()"),
      callPosition(src, "two()"),
    ]);
  });

  it("reports the direct read and the hop separately when both are written", () => {
    expect(codesWith("fn here() -> Text = route.path", "load(route.path + here())")).toEqual([
      "E0120",
      "E0120",
    ]);
  });

  it("emits the same module wherever the fn it walks into is written", () => {
    const head = `slot n : Int = 0
type Box = {get: Text}
slot b : Box = {get: "x"}
effect load cap=storage.read in=Text out=Result(Text, Text)`;
    const fnDef = "fn unwrap(x: Box) -> Text = x.get";
    const tail = `reducer got on=load.ok(_, _) do= n := 1
tile App = column(text(n.show))`;
    const appLine =
      'app A caps=[storage.read] routes={"/" -> App, "/404" -> App} init=[load(unwrap(b))]';

    const emitted = (src: string): string => {
      const result = compile(src, { runtimeSpecifier: "./runtime.js" });
      if (result.kind !== "ok") expect.fail(JSON.stringify(result.errors));
      return result.js;
    };

    expect(emitted(`${head}\n${fnDef}\n${tail}\n${appLine}\n`)).toBe(
      emitted(`${head}\n${tail}\n${appLine}\n${fnDef}\n`),
    );
  });

  it("leaves the same fn alone everywhere the route does exist", () => {
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

  it("leaves a `map-request` that calls the same fn alone, init included", () => {
    const src = `slot n : Int = 0
fn here() -> Text = route.path
effect load cap=storage.read in=Unit out=Result(Text, Text) map-request={key: here()}
reducer got on=load.ok(_, _) do= n := 1
tile App = column(text(n.show))
app A caps=[storage.read] routes={"/" -> App, "/404" -> App} init=[load()]
`;
    expect(check(parse(lex(src)))).toEqual([]);
  });

  it("honours a binding inside the fn that shadows the name", () => {
    expect(codesWith(`fn safe() -> Text = let route = "x" in route`, "load(safe())")).toEqual([]);
    expect(codesWith("fn tail(route: Text) -> Text = route", "load(tail(key))")).toEqual([]);
  });

  it("terminates on a cycle, and still reports the route it reaches", () => {
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
    expect(codesWith("fn here() -> Text = $route.path", "load(here())").sort()).toEqual([
      "E0103",
      "E0120",
    ]);
  });
});
