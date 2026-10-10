import { codegen, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_CALLS,
  type BuiltinArity,
  QUALIFIED_BUILTIN_CALLS,
  QUALIFIED_CALL_NAMESPACES,
  TYPE_MEMBER_CALLS,
  UNIMPLEMENTED_CALLS,
  UNQUALIFIED_BUILTIN_CALLS,
} from "../src/builtin-calls.ts";
import { jsBinding } from "../src/codegen/context.ts";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { compileOrFail, fnLowering } from "./helpers/module.ts";

function inReducer(expr: string): string {
  return `slot a : Int = 0
slot t : Text = ""
fn double(x: Int) -> Int = x * 2
reducer r on=ui.click(B) do= ${expr}
tile B = button(text="b")
tile App = column(B, text(a.show), text(t))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
type Probe = Text
`;
}

const inFn = (callSite: string): string => `slot a : Int = 0
fn probe() -> Text = (${callSite}).show
tile App = column(text(probe()))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
type Probe = Text
`;

const loweringOf = (callSite: string): string => fnLowering(inFn(callSite));

describe("E0116 undef-call", () => {
  it("reports a misspelled call to a user fn", () => {
    expect(checkSource(inReducer("a := doubel(a)"))).toEqual([
      {
        code: "E0116",
        kind: "undef-call",
        message: 'Call to undefined function "doubel"',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("reports a misspelled qualified builtin", () => {
    expect(codesOf(inReducer("t := Decoder.Jsonn(Text)"))).toEqual(["E0116"]);
  });

  it("accepts a declared fn", () => {
    expect(codesOf(inReducer("a := double(a)"))).toEqual([]);
  });

  it("accepts a type member on a qualifier that names a type", () => {
    for (const member of TYPE_MEMBER_CALLS.keys()) {
      const arg = member === "fresh" ? "" : "t";
      expect(codesOf(inReducer(`t := Probe.${member}(${arg}).show`)), member).toEqual([]);
    }
  });

  it("rejects an unknown member on a capitalised qualifier", () => {
    expect(codesOf(inReducer("t := Whatever.frish()"))).toEqual(["E0116"]);
  });

  it("still walks the arguments", () => {
    expect(codesOf(inReducer("a := doubel(missing)")).sort()).toEqual(["E0103", "E0116"]);
  });
});

describe("E0213 call-arity-mismatch", () => {
  it("reports too many arguments to a declared fn", () => {
    expect(checkSource(inReducer("a := double(a, a)"))).toEqual([
      {
        code: "E0213",
        kind: "call-arity-mismatch",
        message: 'Function "double" expects 1 argument(s) but got 2',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("reports too few", () => {
    expect(codesOf(inReducer("a := double()"))).toEqual(["E0213"]);
  });

  it("says nothing when the count matches", () => {
    expect(codesOf(inReducer("a := double(a)"))).toEqual([]);
  });

  it("applies to built-in calls too", () => {
    expect(codesOf(inReducer("a := Duration.s()"))).toEqual(["E0213"]);
    expect(codesOf(inReducer('a := Duration.s(1, 2, "x")'))).toEqual(["E0213"]);
  });

  it("says how many, and where", () => {
    expect(checkSource(inReducer("a := Duration.s()"))).toEqual([
      {
        code: "E0213",
        kind: "call-arity-mismatch",
        message: 'Function "Duration.s" expects 1 argument(s) but got 0',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("counts a template and calls the rest of `fmt` optional", () => {
    expect(codesOf(inReducer('t := fmt("nothing to fill")'))).toEqual([]);
    expect(codesOf(inReducer('t := fmt("{0} {1}", a, a)'))).toEqual([]);
    expect(checkSource(inReducer("t := fmt()"))).toEqual([
      {
        code: "E0213",
        kind: "call-arity-mismatch",
        message: 'Function "fmt" expects at least 1 argument(s) but got 0',
        pos: { line: 4, col: 35 },
      },
    ]);
  });
});

describe("W0214 fmt-placeholder-argument-mismatch", () => {
  it("reports a placeholder the arguments do not reach", () => {
    expect(checkSource(inReducer('t := fmt("{0} {1}", a)'))).toEqual([
      {
        code: "W0214",
        kind: "fmt-placeholder-argument-mismatch",
        message: "fmt template and arguments disagree: {1} has no argument",
        pos: { line: 4, col: 35 },
        severity: "warning",
      },
    ]);
  });

  it("reports an argument no placeholder names", () => {
    expect(checkSource(inReducer('t := fmt("{0}", a, a)'))).toEqual([
      {
        code: "W0214",
        kind: "fmt-placeholder-argument-mismatch",
        message: "fmt template and arguments disagree: argument 3 is named by no placeholder",
        pos: { line: 4, col: 35 },
        severity: "warning",
      },
    ]);
  });

  it("says both halves in one warning when a call is wrong in both directions", () => {
    expect(checkSource(inReducer('t := fmt("{1}", a)')).map((e) => e.message)).toEqual([
      "fmt template and arguments disagree: {1} has no argument; argument 2 is named by no placeholder",
    ]);
  });

  it("is silent on a call that agrees, in any order and with repeats", () => {
    expect(codesOf(inReducer('t := fmt("{1} {0} {1}", a, a)'))).toEqual([]);
    expect(codesOf(inReducer('t := fmt("{0}{01}", a, a)'))).toEqual([]);
  });

  it("says nothing about a template it cannot count", () => {
    expect(codesOf(inReducer("t := fmt(t, a, a)"))).toEqual([]);
    expect(codesOf(inReducer('t := fmt(t + "{0}", a, a)'))).toEqual([]);
  });

  it("leaves a call with no template to E0213, which is fatal", () => {
    expect(codesOf(inReducer("t := fmt()"))).toEqual(["E0213"]);
  });
});

describe("E0802 unimplemented-function", () => {
  it("reports `trace`, which the spec documents and codegen does not lower", () => {
    expect(checkSource(inReducer('a := trace("a", a + 1)'))).toEqual([
      {
        code: "E0802",
        kind: "unimplemented-function",
        message: 'Function "trace" is documented but not implemented by the runtime',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("says nothing when the program declares a `fn` of that name", () => {
    const src = `slot a : Int = 0
fn trace(x: Int) -> Int = x + 1
reducer r on=ui.click(B) do= a := trace(a)
tile B = button(text="b")
tile App = column(B, text(a.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(checkSource(src)).toEqual([]);
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
  });
});

describe("run-reducer is legal only where it lowers", () => {
  it("is rejected in an ordinary reducer", () => {
    expect(codesOf(inReducer('t := run-reducer("inc").show'))).toEqual(["E0116"]);
  });

  it("still resolves inside a property-test invariant", () => {
    const src = `slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="b")
tile App = column(B, text(count.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test round-trips =
    property-test
        for-all   = {count: Int}
        given     = {slots: {count: count}, event: {type: ui.click, target: B}}
        invariant = run-reducer(inc).slots.count == count + 1
`;
    expect(checkSource(src)).toEqual([]);
  });
});

// Generated from the table the checker and codegen both decide by, so a builtin added to it is
// held to this without a line here.
describe("a declared fn wins over a builtin of its name", () => {
  const NAMES = [...UNQUALIFIED_BUILTIN_CALLS, ...UNIMPLEMENTED_CALLS];
  const isKeyword = (name: string) => lex(name)[0]?.kind === "kw";

  // Two `Int`s to an `Int` is no builtin's signature, so a call checked or lowered as the builtin
  // cannot pass for the fn's.
  const declaring = (name: string) => `slot a : Int = 0
slot b : Int = 0
slot xs : List(Int) = [1, 2]
fn ${name}(x: Int, y: Int) -> Int = x + y
fn viaFn(x: Int) -> Int = ${name}(x, 10)
reducer r on=ui.click(B) do=
  a := ${name}(a, 1)
  b := xs.fold(0, ${name})
tile B = button(text="b")
tile App = column(B, text(${name}(a, 2).show), text(viaFn(b).show))
tile Missing = text("missing")
app A caps=[] routes={"/" -> App, "/404" -> Missing} init=[]
test r-adds =
    reducer-test r
        given  = {slots: {a: ${name}(0, 0), b: 0, xs: [1]}, event: {type: ui.click, target: B}}
        expect = {slots: {a: ${name}(0, 1), b: 1}, effects: []}
test holds =
    property-test
        for-all   = {n: Int}
        given     = {slots: {a: n}, event: {type: ui.click, target: B}}
        invariant = ${name}(n, 0) >= n
`;

  const OWN = "plus";

  // Codegen alone, so the lowering is asserted whatever the checker says.
  const emit = (name: string, src = declaring(name)) =>
    codegen(parse(lex(src)), { runtimeSpecifier: "./runtime.js", includeTests: true }).js;

  it("is a program the checker accepts under a name no builtin has", () => {
    expect(checkSource(declaring(OWN))).toEqual([]);
  });

  it("reaches every name but the one the lexer reserves", () => {
    expect(NAMES.filter(isKeyword)).toEqual(["now"]);
    expect(() => parse(lex(declaring("now")))).toThrow("Expected ident, got kw(now)");
  });

  const DECLARABLE = NAMES.filter((n) => !isKeyword(n));

  it.each(DECLARABLE)("checks a call to fn %s against the fn's signature", (name) => {
    expect(checkSource(declaring(name))).toEqual([]);
  });

  it.each(DECLARABLE)("lowers every call to fn %s to the fn", (name) => {
    // A builtin lowers through `_s.`, which the look-behind leaves alone.
    const calls = new RegExp(`(?<![.\\w$])${jsBinding(name)}\\(`, "g");
    expect(emit(name).replace(calls, `${OWN}(`)).toBe(emit(OWN));
  });

  it("leaves the reducer statement `panic(message)` the builtin", () => {
    const src = `slot t : Text = ""
fn panic(x: Text) -> Text = "soft " + x
reducer r on=ui.click(B) do=
  t := panic("expr")
  panic("stmt")
tile B = button(text="b")
tile App = column(B, text(t))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(checkSource(src)).toEqual([]);
    const js = emit("panic", src);
    expect(js).toContain('_next["t"] = panic("expr");');
    expect(js).toContain('_s.panic("stmt");');
    expect(js).not.toContain('_s.panic("expr")');
  });

  it("leaves run-reducer the builtin where no fn has the name", () => {
    const src = `slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="b")
tile App = column(B, text(count.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test holds =
    property-test
        for-all   = {n: Int}
        given     = {slots: {count: n}, event: {type: ui.click, target: B}}
        invariant = run-reducer(inc).slots.count == n + 1
`;
    expect(checkSource(src)).toEqual([]);
    const js = emit("run-reducer", src);
    expect(js).toContain('_s.runReducerStep(App, _init, "inc", _event)');
    expect(js).toContain('reducers: { total: ["inc"], used: ["inc"] }');
  });

  it("counts no reducer as run by a property-test call to fn run-reducer", () => {
    // Called as the fn, `inc` is the for-all value of that name, and no reducer runs.
    const src = `slot count : Int = 0
fn run-reducer(x: Int) -> Int = x + 1
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="b")
tile App = column(B, text(count.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test holds =
    property-test
        for-all   = {inc: Int}
        given     = {slots: {count: inc}, event: {type: ui.click, target: B}}
        invariant = run-reducer(inc) == inc + 1
`;
    expect(checkSource(src)).toEqual([]);
    expect(emit("run-reducer", src)).toContain('reducers: { total: ["inc"], used: [] }');
  });
});

describe("prefers-dark", () => {
  const DARK_MODE = `slot themeName : Text = "Light"
reducer initTheme on=app.start do= themeName := if prefers-dark() then "Dark" else "Light"
tile App = column(text(themeName))
theme Light = { colors: { bg: "#fff" } }
theme Dark  = { colors: { bg: "#000" } }
app A caps=[] routes={"/" -> App, "/404" -> App} init=[] theme=Light
`;

  it("typechecks the dark-mode reducer from the style spec", () => {
    expect(checkSource(DARK_MODE)).toEqual([]);
  });

  it("lowers to the runtime helper rather than an undefined global", () => {
    const js = compileOrFail(DARK_MODE);
    expect(js).toContain("_s.prefersDark()");
    expect(js).not.toContain("prefers_dark(");
  });
});

describe("app.init entries are validated like an emit", () => {
  const app = (init: string, caps = "storage.read") => `slot n : Int = 0
effect load cap=storage.read in=Text out=Result(Text, Text)
reducer got on=load.ok(_, _) do= n := 1
tile App = column(text(n.show))
app A caps=[${caps}] routes={"/" -> App, "/404" -> App} init=[${init}]
`;

  it("accepts a declared effect", () => {
    expect(codesOf(app('load("k")'))).toEqual([]);
  });

  it("reports an undefined one as E0104, not as a missing function", () => {
    expect(codesOf(app('looad("k")'))).toEqual(["E0104"]);
  });

  it("accepts the built-in effects, which are not in the effect table", () => {
    expect(
      codesOf(app('toast({kind: "info", text: "hello"})', "storage.read, notification.show")),
    ).toEqual([]);
  });

  it("holds a built-in effect to its capability too", () => {
    expect(codesOf(app('toast({kind: "info", text: "hello"})'))).toEqual(["E0301"]);
  });

  it("holds a built-in effect's argument to its in= too", () => {
    expect(codesOf(app('navigate("/x")', "nav.push"))).toEqual(["E0202"]);
    expect(codesOf(app("toast()", "notification.show"))).toEqual(["E0213"]);
    expect(codesOf(app('navigate({path: "/x"})', "nav.push"))).toEqual([]);
  });

  it("reports a capability the app does not declare", () => {
    expect(codesOf(app('load("k")', ""))).toEqual(["E0301"]);
  });

  it("rejects a qualified callee, which names no effect at all", () => {
    expect(codesOf(app("Duration.ms(5)"))).toEqual(["E0104"]);
  });

  it("rejects an entry that is not a call", () => {
    expect(checkSource(app("n"))).toEqual([
      {
        code: "E0104",
        kind: "init-not-effect-call",
        message: "app.init entries must be effect calls",
        pos: { line: 5, col: 68 },
      },
    ]);
  });
});

describe("the checker accepts exactly what codegen lowers", () => {
  const CALL_SITE: Record<string, string> = {
    now: "now",
    random: "random()",
    fmt: 'fmt("{0}", 1)',
    panic: 'panic("x")',
    "file-url": "file-url(1)",
    "prefers-dark": "prefers-dark()",
    "EffectId.none": "EffectId.none",
    "Decoder.Json": "Decoder.Json(Text)",
    "Decoder.Text": "Decoder.Text()",
    "Decoder.Bytes": "Decoder.Bytes()",
    "Decoder.None": "Decoder.None()",
    "Bytes.from-text": 'Bytes.from-text("x")',
    "Bytes.from-base64": 'Bytes.from-base64("x")',
    "Bytes.from-bytes": "Bytes.from-bytes([1])",
  };

  const named = [...BUILTIN_CALLS.keys(), ...QUALIFIED_BUILTIN_CALLS.keys()];

  it("has a call site for every builtin in the tables", () => {
    const missing = named.filter((n) => !CALL_SITE[n] && !n.startsWith("Duration."));
    expect(missing).toEqual([]);
  });

  it("covers the whole of both name tables, not a subset", () => {
    expect(named.length).toBe(BUILTIN_CALLS.size + QUALIFIED_BUILTIN_CALLS.size);
    expect([...TYPE_MEMBER_CALLS.keys()].some((m) => named.includes(m))).toBe(false);
  });

  for (const name of named) {
    const site = CALL_SITE[name] ?? `${name}(1)`;
    it(`${name} does not lower to the user-fn fallback`, () => {
      const body = loweringOf(site);
      for (const spelling of [name, name.replace(/[.-]/g, "_")]) {
        const bare = new RegExp(`(?<![.\\w$])${spelling.replace(/\./g, "\\.")}\\s*\\(`);
        expect(body, `${name} fell through to the fallback: ${body}`).not.toMatch(bare);
      }
    });
  }

  it("multiplies by the unit it names", () => {
    const MILLISECONDS: Record<string, string> = {
      "Duration.ms": "(2)",
      "Duration.s": "((2) * 1000)",
      "Duration.m": "((2) * 60000)",
      "Duration.min": "((2) * 60000)",
      "Duration.h": "((2) * 3600000)",
      "Duration.d": "((2) * 86400000)",
      "Duration.days": "((2) * 86400000)",
    };
    for (const [name, js] of Object.entries(MILLISECONDS)) {
      expect(loweringOf(`${name}(2)`), name).toContain(js);
    }
    expect(Object.keys(MILLISECONDS).sort()).toEqual(
      [...QUALIFIED_BUILTIN_CALLS.keys()].filter((n) => n.startsWith("Duration.")).sort(),
    );
  });

  it("a name codegen has no lowering for is not in the tables", () => {
    for (const name of UNIMPLEMENTED_CALLS) {
      expect(BUILTIN_CALLS.has(name)).toBe(false);
      expect(QUALIFIED_BUILTIN_CALLS.has(name)).toBe(false);
    }
  });
});

describe("a qualified stdlib member is read the same way without its parentheses", () => {
  const SENTINEL: Record<string, string> = {
    "Decoder.Json": '"json"',
    "Decoder.Text": '"text"',
    "Decoder.Bytes": '"bytes"',
    "Decoder.None": '"none"',
    "EffectId.none": '""',
  };

  it("pins the lowering of every member the parser reads bare, and nothing stale", () => {
    const listed = new Set(Object.keys(SENTINEL));
    const inNamespace = (n: string) => QUALIFIED_CALL_NAMESPACES.has(n.slice(0, n.indexOf(".")));
    for (const [name, arity] of QUALIFIED_BUILTIN_CALLS) {
      if (!inNamespace(name) || arity.min > 0) continue;
      expect(listed.has(name), name).toBe(true);
    }
    // Nothing stale: every sentinel names a member of a listed namespace.
    for (const name of listed) {
      expect(inNamespace(name) && QUALIFIED_BUILTIN_CALLS.has(name), name).toBe(true);
    }
  });

  it("holds the qualifiers of the qualified builtins, and only those", () => {
    const qualifierOf = (n: string) => n.slice(0, n.indexOf("."));
    const declared = new Set([...QUALIFIED_BUILTIN_CALLS.keys()].map(qualifierOf));
    expect([...QUALIFIED_CALL_NAMESPACES].sort()).toEqual([...declared].sort());
  });

  it("reads a member that takes an argument, written bare, as a call with none", () => {
    for (const [name, arity] of QUALIFIED_BUILTIN_CALLS) {
      if (arity.min === 0) continue;
      expect(codesOf(inReducer(`t := (${name}).show`)), name).toEqual(["E0213"]);
    }
  });

  it("gives the bare spelling the sentence and the position of the written one", () => {
    const bare = checkSource(inReducer("t := (Duration.s).show"));
    expect(bare).toEqual([
      {
        code: "E0213",
        kind: "call-arity-mismatch",
        message: 'Function "Duration.s" expects 1 argument(s) but got 0',
        pos: { line: 4, col: 36 },
      },
    ]);
    expect(checkSource(inReducer("t := (Duration.s()).show"))).toEqual(bare);
    expect(checkSource(inReducer("t := (Duration.nope).show"))).toEqual([
      {
        code: "E0116",
        kind: "undef-call",
        message: 'Call to undefined function "Duration.nope"',
        pos: { line: 4, col: 36 },
      },
    ]);
  });

  it("reports it in a fn body too, where it used to compile", () => {
    expect(codesOf(inFn("Duration.s"))).toEqual(["E0213"]);
    expect(codesOf(inFn("Duration.nope"))).toEqual(["E0116"]);
  });

  it("reads a keyword member the same way, in either spelling", () => {
    for (const where of ["Decoder.if", "Duration.if", "Bytes.if"]) {
      expect(codesOf(inReducer(`t := (${where}).show`)), where).toEqual(["E0116"]);
    }
    expect(codesOf(inReducer("t := (Decoder.if(a)).show"))).toEqual(["E0116"]);
  });

  it("claims the qualifier position and not the name", () => {
    const src = `type Duration = Short | Long
slot d : Duration = Short
slot t : Text = ""
reducer pick on=ui.click(B) do= d := Long
tile B = button(text="b")
tile App = column(B, text(t), text(d.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(codesOf(src)).toEqual([]);
  });

  it("leaves a listed name usable as a value and as a pattern", () => {
    const src = `type Span = Duration | Instant
slot p : Span = Duration
slot t : Text = ""
reducer flip on=ui.click(B) do= t := match p with | Duration -> "d" | Instant -> "i"
tile B = button(text="b")
tile App = column(B, text(t))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(codesOf(src)).toEqual([]);
  });

  it("reports a bare member the namespace does not declare by name", () => {
    expect(codesOf(inReducer("t := (Duration.nope).show"))).toEqual(["E0116"]);
    expect(codesOf(inReducer("t := (Bytes.from-json).show"))).toEqual(["E0116"]);
  });

  it("a member of a listed namespace is only what the table lists", () => {
    for (const namespace of QUALIFIED_CALL_NAMESPACES) {
      for (const member of TYPE_MEMBER_CALLS.keys()) {
        const where = `${namespace}.${member}`;
        expect(codesOf(inReducer(`t := (${where}).show`)), where).toEqual(["E0116"]);
        expect(codesOf(inReducer(`t := (${where}()).show`)), `${where}()`).toEqual(["E0116"]);
      }
    }
  });

  it("still accepts a type member that was given its argument", () => {
    expect(codesOf(inReducer("t := EffectId.show(a)"))).toEqual([]);
  });

  for (const [name, sentinel] of Object.entries(SENTINEL)) {
    if (name !== "Decoder.Json") {
      it(`${name} lowers to ${sentinel} with no parentheses`, () => {
        const body = loweringOf(name);
        expect(body).toContain(`_s.show(${sentinel})`);
        expect(body).not.toContain("_tag:");
      });
    }

    it(`${name} lowers the same way written as a call`, () => {
      const body = loweringOf(name === "Decoder.Json" ? `${name}(Text)` : `${name}()`);
      expect(body).toContain(`_s.show(${sentinel})`);
    });
  }

  it("the constant that carries a payload type is an argument short without it", () => {
    expect(codesOf(inReducer("t := (Decoder.Json).show"))).toEqual(["E0213"]);
    expect(codesOf(inReducer("t := (Decoder.Json(Text)).show"))).toEqual([]);
  });

  it("reports a misspelt member of a listed namespace", () => {
    expect(codesOf(inReducer("t := (Decoder.Nope).show"))).toEqual(["E0116"]);
    expect(codesOf(inReducer("t := (EffectId.nope).show"))).toEqual(["E0116"]);
  });

  it("still reports one written with parentheses", () => {
    expect(codesOf(inReducer("t := (Decoder.Nope(Text)).show"))).toEqual(["E0116"]);
  });

  it("accepts the constants themselves", () => {
    expect(codesOf(inReducer("t := (Decoder.None).show"))).toEqual([]);
    expect(codesOf(inReducer("t := (EffectId.none).show"))).toEqual([]);
  });
});

describe("every built-in is held to the count its lowering reads", () => {
  const fillerOf = (name: string) => (name === "parse" ? `"1"` : "1");

  /** `fresh` / `parse` / `show` resolve on any capitalised qualifier. */
  const QUALIFIER = "Probe";

  function callOf(name: string): (n: number) => string {
    const spelling = TYPE_MEMBER_CALLS.has(name) ? `${QUALIFIER}.${name}` : name;
    const filler = fillerOf(name);
    return (n) => `${spelling}(${Array.from({ length: n }, () => filler).join(", ")})`;
  }

  const ALL: [string, BuiltinArity][] = [
    ...BUILTIN_CALLS,
    ...QUALIFIED_BUILTIN_CALLS,
    ...TYPE_MEMBER_CALLS,
  ];

  const PARSER_FIXED = new Set(["now"]);

  const NAMED = ALL.filter(([name]) => !PARSER_FIXED.has(name));

  it("covers all three tables", () => {
    expect(ALL.length).toBe(
      BUILTIN_CALLS.size + QUALIFIED_BUILTIN_CALLS.size + TYPE_MEMBER_CALLS.size,
    );
    expect([...PARSER_FIXED].every((n) => BUILTIN_CALLS.has(n))).toBe(true);
  });

  const EXPECTED: Record<string, string> = {
    now: "0",
    random: "0",
    "prefers-dark": "0",
    fmt: "1+",
    panic: "1",
    "file-url": "1",
    "EffectId.none": "0",
    "Duration.ms": "1",
    "Duration.s": "1",
    "Duration.m": "1",
    "Duration.min": "1",
    "Duration.h": "1",
    "Duration.d": "1",
    "Duration.days": "1",
    "Bytes.from-text": "1",
    "Bytes.from-base64": "1",
    "Bytes.from-bytes": "1",
    "Decoder.Json": "1",
    "Decoder.Text": "0",
    "Decoder.Bytes": "0",
    "Decoder.None": "0",
    fresh: "0",
    parse: "1",
    show: "1",
  };

  it("takes what the standard library says it takes", () => {
    const spelled = ([name, a]: [string, BuiltinArity]): [string, string] => [
      name,
      a.min === a.max ? `${a.min}` : `${a.min}+`,
    ];
    expect(Object.fromEntries(ALL.map(spelled))).toEqual(EXPECTED);
  });

  it("does not reach the one the parser spells for you", () => {
    expect(codesOf(inReducer("t := now.show"))).toEqual([]);
    expect(() => parse(lex(inReducer("t := now(1).show")))).toThrow(/Expected/);
  });

  for (const [name, arity] of NAMED) {
    const call = callOf(name);

    it(`${name} accepts ${arity.min}`, () => {
      expect(codesOf(inReducer(`t := (${call(arity.min)}).show`))).toEqual([]);
    });

    if (arity.min > 0) {
      it(`${name} reports one argument too few`, () => {
        expect(codesOf(inReducer(`t := (${call(arity.min - 1)}).show`))).toEqual(["E0213"]);
      });
    }

    if (Number.isFinite(arity.max)) {
      it(`${name} reports one argument too many`, () => {
        expect(codesOf(inReducer(`t := (${call(arity.max + 1)}).show`))).toEqual(["E0213"]);
      });
    }
  }
});

describe("codegen no longer supplies what the call omitted", () => {
  const src = (expr: string) => `slot a : Int = 0
slot t : Text = ""
reducer r on=ui.click(B) do= t := (${expr}).show
tile B = button(text="b")
tile App = column(B, text(a.show), text(t))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

  const emit = (source: string) =>
    codegen(parse(lex(source)), { runtimeSpecifier: "./runtime.js" });

  /** `Q.m()` for a qualified name, `Probe.m()` for a bare type member. */
  const spellingOf = (name: string) => (TYPE_MEMBER_CALLS.has(name) ? `Probe.${name}` : name);

  const REQUIRES_ONE = [...BUILTIN_CALLS, ...QUALIFIED_BUILTIN_CALLS, ...TYPE_MEMBER_CALLS]
    .filter(([, arity]) => arity.min > 0)
    .map(([name]) => name);

  for (const name of REQUIRES_ONE) {
    const expr = `${spellingOf(name)}()`;
    if (name === "Decoder.Json") {
      it(`${expr} lowers to its sentinel, which reads no argument to be missing`, () => {
        expect(emit(src(expr))).toBeTruthy();
      });
      continue;
    }
    it(`${expr} throws out of codegen instead of lowering`, () => {
      expect(() => emit(src(expr))).toThrow(/missing its argument/);
    });
  }

  it("says where, since that is all the author is given", () => {
    expect(() => emit(src("Duration.s()"))).toThrow(/Duration\.s\(\) at 3:36 is missing/);
  });

  it("compile() reports the diagnostic rather than throwing", () => {
    const result = compile(src("Duration.s()"), { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("fail");
    expect(result.kind === "fail" && result.errors.map((e) => e.code)).toEqual(["E0213"]);
  });

  it("reaches an app.http field, which the checker used to walk past", () => {
    const inHttpField = `slot t : Text = ""
tile App = column(text(t))
app A caps=[http.get]
    routes={"/" -> App, "/404" -> App}
    http={base-url: "https://x", timeout: Duration.s()}
    init=[]
`;
    expect(checkSource(inHttpField)).toEqual([
      {
        code: "E0213",
        kind: "call-arity-mismatch",
        message: 'Function "Duration.s" expects 1 argument(s) but got 0',
        pos: { line: 5, col: 43 },
      },
    ]);
    const result = compile(inHttpField, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind === "fail" && result.errors.map((e) => e.code)).toEqual(["E0213"]);
  });
});

describe("the qualifier of a type-member call", () => {
  it("reports a qualifier that names no type", () => {
    expect(checkSource(inReducer('t := Itn.parse(t).get-or("")'))).toEqual([
      {
        code: "E0117",
        kind: "undef-type",
        message: 'Reference to undefined type "Itn"',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("accepts the primitives, which are not in the type table", () => {
    expect(codesOf(inReducer("a := Int.parse(t).get-or(0)"))).toEqual([]);
    expect(codesOf(inReducer("t := Float.parse(t).get-or(0.0).show"))).toEqual([]);
    expect(codesOf(inReducer("t := Time.show(a)"))).toEqual([]);
    expect(codesOf(inReducer("t := EffectId.show(a)"))).toEqual([]);
  });

  it("accepts a type the program declares, and a standard-library one", () => {
    expect(codesOf(inReducer("t := Probe.fresh()"))).toEqual([]);
    expect(codesOf(inReducer("t := Url.show(a)"))).toEqual([]);
  });

  it("leaves an unknown member to E0116, which is a different mistake", () => {
    expect(codesOf(inReducer("t := Whatever.frish()"))).toEqual(["E0116"]);
    expect(codesOf(inReducer("t := Probe.frish()"))).toEqual(["E0116"]);
  });

  it("reports a namespace that is not a type either", () => {
    expect(codesOf(inReducer('t := Decoder.parse(t).get-or("")'))).toEqual(["E0117"]);
  });

  it("keeps a qualified E0116's message shape readable too", () => {
    expect(checkSource(inReducer("a := Int.pasre(t).get-or(0)"))).toEqual([
      {
        code: "E0116",
        kind: "undef-call",
        message: 'Call to undefined function "Int.pasre"',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("keeps the message shape a repair can read", () => {
    const [err] = checkSource(inReducer('t := Itn.parse(t).get-or("")'));
    expect(err?.message).toMatch(/^Reference to undefined type "[^"]+"$/);
  });
});

describe("the result type of a qualified `show`", () => {
  const QUALIFIERS = [
    // The primitives, which never reach `sym.types`.
    "Int",
    "Float",
    "Time",
    "EffectId",
    // The standard library's types.
    "Duration",
    "Bytes",
    "Url",
    // A type the program declares.
    "Probe",
  ];

  it("is Text for every qualifier, so a Text target accepts it", () => {
    for (const q of QUALIFIERS) {
      expect(codesOf(inReducer(`t := ${q}.show(a)`)), q).toEqual([]);
    }
  });

  it("is Text rather than undecidable, so a non-Text target still refuses it", () => {
    for (const q of QUALIFIERS) {
      expect(codesOf(inReducer(`a := ${q}.show(a)`)), q).toEqual(["E0201"]);
    }
  });

  it("names Text in the diagnostic, whichever qualifier was written", () => {
    for (const q of QUALIFIERS) {
      const [err] = checkSource(inReducer(`a := ${q}.show(a)`));
      expect(err?.message, q).toBe("Expected Int but got Text");
    }
  });

  it("lowers to the one helper, whichever qualifier was written", () => {
    for (const q of QUALIFIERS) {
      expect(loweringOf(`${q}.show(1)`), q).toContain("_s.show(1)");
    }
  });

  it("still answers a Duration / Bytes constructor with its own type", () => {
    expect(codesOf(inReducer("t := Duration.ms(500)"))).toEqual(["E0201"]);
    expect(codesOf(inReducer("t := Bytes.from-text(t)"))).toEqual(["E0201"]);
  });
});
