// `checkExpr`'s `Call` case walked the arguments and returned, so the callee
// was never resolved by anything. Codegen's fallback turns an unknown callee
// into a call to a JS binding of that name, which means a typo compiled, built
// and then threw `doubel is not defined` on the first interaction — the whole
// point of a name-resolution band bypassed for one expression form.

import { check, codegen, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
// The tables are internal to the compiler — see `src/index.ts` for why they are
// not published — so this reaches for them directly, as `ui-lifts.test.ts` does.
import {
  BUILTIN_CALLS,
  type BuiltinArity,
  QUALIFIED_BUILTIN_CALLS,
  QUALIFIED_CALL_NAMESPACES,
  TYPE_MEMBER_CALLS,
  UNIMPLEMENTED_CALLS,
} from "../src/builtin-calls.ts";

/**
 * A program whose reducer body is `expr`, with a fn and a slot to call into.
 *
 * `type Probe` is last so that adding it left every position this file asserts
 * where it was — the definitions of a `.kumiki` source are a set, not a
 * sequence, and a test whose expected line moves says nothing about the change
 * that moved it.
 */
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

const codes = (src: string) => check(parse(lex(src))).map((e) => e.code);

/**
 * The generated body of `fn probe`, which is where a call site lands. Reading
 * that one line rather than the module keeps the assertions honest: the whole
 * module drags in the runtime helper prelude, whose own source contains most of
 * these names.
 */
function loweringOf(callSite: string): string {
  const src = `slot a : Int = 0
fn probe() -> Text = (${callSite}).show
tile App = column(text(probe()))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
type Probe = Text
`;
  const result = compile(src, { runtimeSpecifier: "./runtime.js" });
  if (result.kind !== "ok") {
    throw new Error(`compile failed: ${result.errors.map((e) => e.code).join(", ")}`);
  }
  const body = result.js.split("\n").find((l) => l.includes("function probe"));
  if (body === undefined) throw new Error("no `function probe` in the generated module");
  return body;
}

describe("E0116 undef-call", () => {
  it("reports a misspelled call to a user fn", () => {
    expect(check(parse(lex(inReducer("a := doubel(a)"))))).toEqual([
      {
        code: "E0116",
        kind: "undef-call",
        message: 'Call to undefined function "doubel"',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("reports a misspelled qualified builtin", () => {
    expect(codes(inReducer("t := Decoder.Jsonn(Text)"))).toEqual(["E0116"]);
  });

  it("accepts a declared fn", () => {
    expect(codes(inReducer("a := double(a)"))).toEqual([]);
  });

  it("accepts a type member on a qualifier that names a type", () => {
    for (const member of TYPE_MEMBER_CALLS.keys()) {
      const arg = member === "fresh" ? "" : "t";
      expect(codes(inReducer(`t := Probe.${member}(${arg}).show`)), member).toEqual([]);
    }
  });

  it("rejects an unknown member on a capitalised qualifier", () => {
    expect(codes(inReducer("t := Whatever.frish()"))).toEqual(["E0116"]);
  });

  it("still walks the arguments", () => {
    // The callee is unresolved AND the argument names nothing — both are real,
    // and reporting only the outer one would hide the inner typo behind a fix
    // for the outer.
    expect(codes(inReducer("a := doubel(missing)")).sort()).toEqual(["E0103", "E0116"]);
  });
});

describe("E0213 call-arity-mismatch", () => {
  it("reports too many arguments to a declared fn", () => {
    expect(check(parse(lex(inReducer("a := double(a, a)"))))).toEqual([
      {
        code: "E0213",
        kind: "call-arity-mismatch",
        message: 'Function "double" expects 1 argument(s) but got 2',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("reports too few", () => {
    expect(codes(inReducer("a := double()"))).toEqual(["E0213"]);
  });

  it("says nothing when the count matches", () => {
    expect(codes(inReducer("a := double(a)"))).toEqual([]);
  });

  it("applies to built-in calls too", () => {
    // This used to assert the opposite, on the grounds that a builtin's
    // arguments are whatever its lowering reads. What that cost is visible in
    // the first line: `Duration.s()` lowered to `((0) * 1000)`, so a timer
    // written with an empty duration fired immediately and forever, with
    // check, build and smoke all green. The second dropped its tail silently.
    expect(codes(inReducer("a := Duration.s()"))).toEqual(["E0213"]);
    expect(codes(inReducer('a := Duration.s(1, 2, "x")'))).toEqual(["E0213"]);
  });

  it("says how many, and where", () => {
    expect(check(parse(lex(inReducer("a := Duration.s()"))))).toEqual([
      {
        code: "E0213",
        kind: "call-arity-mismatch",
        message: 'Function "Duration.s" expects 1 argument(s) but got 0',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("counts a template and calls the rest of `fmt` optional", () => {
    // The one variadic builtin: `fmt(template, ...args)`. A minimum is all
    // that can be asked of it, and the message has to say so rather than name
    // a number the call could never satisfy.
    expect(codes(inReducer('t := fmt("nothing to fill")'))).toEqual([]);
    expect(codes(inReducer('t := fmt("{0} {1}", a, a)'))).toEqual([]);
    expect(check(parse(lex(inReducer("t := fmt()"))))).toEqual([
      {
        code: "E0213",
        kind: "call-arity-mismatch",
        message: 'Function "fmt" expects at least 1 argument(s) but got 0',
        pos: { line: 4, col: 35 },
      },
    ]);
  });
});

// stdlib.md §2.4.5 decides what a disagreeing `fmt` call does at runtime — a
// placeholder the arguments do not reach stays as written, an argument no
// placeholder names is dropped — and neither stops the program. The second is
// the one with no trace: `fmt("{0}", a, a)` renders exactly what the correct
// call renders, so no tier below this one can see the value that went missing.
describe("W0214 fmt-placeholder-argument-mismatch", () => {
  it("reports a placeholder the arguments do not reach", () => {
    expect(check(parse(lex(inReducer('t := fmt("{0} {1}", a)'))))).toEqual([
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
    expect(check(parse(lex(inReducer('t := fmt("{0}", a, a)'))))).toEqual([
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
    // `fmt("{1}", a)` names an index it does not have AND ignores the one it
    // does. Two warnings on one call would read as two mistakes.
    expect(check(parse(lex(inReducer('t := fmt("{1}", a)')))).map((e) => e.message)).toEqual([
      "fmt template and arguments disagree: {1} has no argument; argument 2 is named by no placeholder",
    ]);
  });

  it("is silent on a call that agrees, in any order and with repeats", () => {
    expect(codes(inReducer('t := fmt("{1} {0} {1}", a, a)'))).toEqual([]);
    // `{01}` is index 1 — the digits are one decimal index. Read as literal
    // text instead, the second argument would be unnamed and this would warn.
    expect(codes(inReducer('t := fmt("{0}{01}", a, a)'))).toEqual([]);
  });

  it("says nothing about a template it cannot count", () => {
    // A slot carries no placeholder set at compile time. Reporting on the
    // shape of the literal that initialised it would be a guess about a value
    // any reducer may since have replaced.
    expect(codes(inReducer("t := fmt(t, a, a)"))).toEqual([]);
    expect(codes(inReducer('t := fmt(t + "{0}", a, a)'))).toEqual([]);
  });

  it("leaves a call with no template to E0213, which is fatal", () => {
    expect(codes(inReducer("t := fmt()"))).toEqual(["E0213"]);
  });
});

describe("E0802 unimplemented-function", () => {
  it("reports `trace`, which the spec documents and codegen does not lower", () => {
    expect(check(parse(lex(inReducer('a := trace("a", a + 1)'))))).toEqual([
      {
        code: "E0802",
        kind: "unimplemented-function",
        message: 'Function "trace" is documented but not implemented by the runtime',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("says nothing when the program declares a `fn` of that name", () => {
    // Codegen has no builtin case for `trace`, so a declared one takes the
    // user-fn fallback and the program runs. Reporting E0802 here would reject
    // a working program and blame the author for the toolchain's gap.
    const src = `slot a : Int = 0
fn trace(x: Int) -> Int = x + 1
reducer r on=ui.click(B) do= a := trace(a)
tile B = button(text="b")
tile App = column(B, text(a.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src)))).toEqual([]);
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
  });
});

describe("run-reducer is legal only where it lowers", () => {
  it("is rejected in an ordinary reducer", () => {
    // It lowers to `_s.runReducerStep(App, _init, …)`, and `_init` exists only
    // inside a generated property-test trial. Accepting it anywhere else is
    // check-green, build-green, `_init is not defined` on the first click.
    expect(codes(inReducer('t := run-reducer("inc").show'))).toEqual(["E0116"]);
  });

  it("still resolves inside a property-test invariant", () => {
    // `checkTest` walks the invariant itself and never calls `checkExpr`, so
    // the callee never reaches `checkCallee` — which is why removing it from
    // the builtin table costs the legitimate use nothing.
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
    expect(check(parse(lex(src)))).toEqual([]);
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
    expect(check(parse(lex(DARK_MODE)))).toEqual([]);
  });

  it("lowers to the runtime helper rather than an undefined global", () => {
    const result = compile(DARK_MODE, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("_s.prefersDark()");
    expect(result.js).not.toContain("prefers_dark(");
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
    expect(codes(app('load("k")'))).toEqual([]);
  });

  it("reports an undefined one as E0104, not as a missing function", () => {
    // An init entry is an effect call by the grammar, so the candidate set is
    // the effect namespace — E0116 would send `kumiki fix` looking for a fn.
    expect(codes(app('looad("k")'))).toEqual(["E0104"]);
  });

  it("accepts the built-in effects, which are not in the effect table", () => {
    // `toast` / `navigate` / `log` and the rest are legal at an `emit`, and
    // codegen's installer DCE already assumes an init entry can name one.
    expect(codes(app('toast("hello")', "storage.read, notification.show"))).toEqual([]);
  });

  it("holds a built-in effect to its capability too", () => {
    // Not having an `effect` declaration to read a `cap=` off is why this was
    // the one emit that never had to declare anything.
    expect(codes(app('toast("hello")'))).toEqual(["E0301"]);
  });

  it("reports a capability the app does not declare", () => {
    expect(codes(app('load("k")', ""))).toEqual(["E0301"]);
  });

  it("rejects a qualified callee, which names no effect at all", () => {
    // `Duration.ms` is a real builtin, so the callee resolved; what it is not
    // is an effect. The dispatcher drops the entry and the app boots without
    // its bootstrap effect, all three tiers green.
    expect(codes(app("Duration.ms(5)"))).toEqual(["E0104"]);
  });

  it("rejects an entry that is not a call", () => {
    expect(check(parse(lex(app("n"))))).toEqual([
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
  // Every builtin has a bespoke lowering, and the fallback silently produces a
  // call to a JS binding of the same name. A name in the table that codegen
  // forgot would therefore pass `check` and throw at runtime — which is the
  // defect this whole file exists to close, one level up.
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
    // Duration is uniform enough to generate; the rest are listed explicitly so
    // adding a builtin forces a decision about how it is exercised here.
    const missing = named.filter((n) => !CALL_SITE[n] && !n.startsWith("Duration."));
    expect(missing).toEqual([]);
  });

  it("covers the whole of both name tables, not a subset", () => {
    // `TYPE_MEMBER_CALLS` is checked for acceptance above but has no lowering
    // case of its own — codegen matches `<Qualifier>.fresh|parse|show` by
    // regex — so it is deliberately outside this loop. Stating that here keeps
    // the guard's reach explicit rather than implied by the filter above.
    expect(named.length).toBe(BUILTIN_CALLS.size + QUALIFIED_BUILTIN_CALLS.size);
    expect([...TYPE_MEMBER_CALLS.keys()].some((m) => named.includes(m))).toBe(false);
  });

  for (const name of named) {
    const site = CALL_SITE[name] ?? `${name}(1)`;
    it(`${name} does not lower to the user-fn fallback`, () => {
      const body = loweringOf(site);
      // The fallback emits `<binding>(args)` — the callee's own spelling, with
      // `.` and `-` folded to `_`, called directly. A real lowering reaches it
      // through `_s.` or replaces it outright, so requiring no preceding dot is
      // what separates `_s.now()` from a bare `now()`.
      for (const spelling of [name, name.replace(/[.-]/g, "_")]) {
        const bare = new RegExp(`(?<![.\\w$])${spelling.replace(/\./g, "\\.")}\\s*\\(`);
        expect(body, `${name} fell through to the fallback: ${body}`).not.toMatch(bare);
      }
    });
  }

  it("multiplies by the unit it names", () => {
    // Nothing pinned these numbers: a wrong factor compiles, builds, renders
    // and only shows up as a timer that fires at the wrong moment. They are
    // here because every one of these lines was rewritten to require its
    // argument, and an argument is not the only thing they can get wrong.
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
  // `docs/spec/http.md` §6.1.4 writes `Decoder.Text` / `Decoder.Bytes` /
  // `Decoder.None` with no parentheses, and `stdlib.md` §2.1.1.1 writes
  // `EffectId.none` as a value. Only `EffectId.none` ever parsed that way — the
  // parser carried a one-off for exactly that spelling — so every other constant
  // fell through to a field read on a freshly built variant and emitted
  // `undefined`.
  //
  // The HTTP handler reads `decode ?? "json"`, so that `undefined` meant json
  // and a body meant to be discarded was parsed. This file pins the emitted
  // sentinel, which is the narrowest place to see it; `packages/tests` pins what
  // it did to a running app, and `kumiki smoke` on the example reports it too.
  //
  // Every qualifier is read this way now, `Duration` and `Bytes` included,
  // which is why this block asserts two different things about the bare form:
  // a member with no arguments is a value and lowers to its sentinel, and a
  // member with arguments is a call that was given none.
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
    // Nothing unpinned: a zero-argument member of a listed namespace is exactly
    // what the parser reads as a value, so each one carries its sentinel here.
    // The `arity.min` skip is what makes this a containment rather than an
    // equality — a member that takes an argument is not read bare as a value,
    // so `Decoder.Json` is in `SENTINEL` (it lowers to one) without being
    // required by this direction, and is pinned in its parenthesised form
    // below. What the bare spelling of such a member does is the next test.
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
    // Not "every qualifier codegen lowers" — `TYPE_MEMBER_CALLS` lowers on any
    // capitalised name, and `Int` is deliberately absent. The claim is the
    // narrower one: the set and `QUALIFIED_BUILTIN_CALLS` name the same
    // qualifiers.
    //
    // Leaving one out never made its bare spelling an error — it made it a
    // field read on a freshly built variant. `Duration.s` was
    // `{_tag: "Duration"}["s"]`, an `undefined` that nothing reported, and a
    // `setTimeout(undefined)` is a `setTimeout(0)`: the failure the arity check
    // exists for, reached by the spelling that skipped the check.
    const qualifierOf = (n: string) => n.slice(0, n.indexOf("."));
    const declared = new Set([...QUALIFIED_BUILTIN_CALLS.keys()].map(qualifierOf));
    expect([...QUALIFIED_CALL_NAMESPACES].sort()).toEqual([...declared].sort());
    // The second direction is the one with teeth: an entry here that the map
    // has no member for turns every bare `Foo.x` into an E0116 for a namespace
    // that declares nothing, and no other assertion in this file notices —
    // `SENTINEL` covers only the two namespaces with constants, and the
    // closed-membership test passes for a namespace with no members at all.
  });

  it("reads a member that takes an argument, written bare, as a call with none", () => {
    // The cost of listing a namespace whose members are not constants, which is
    // the point of listing it: `Duration.s` is a zero-argument call to a member
    // declared with one, so it is the same E0213 as `Duration.s()`. Every such
    // member is checked rather than one, so `Decoder.Json` — the one member of
    // an otherwise constant namespace that carries a payload type — is held to
    // it too.
    for (const [name, arity] of QUALIFIED_BUILTIN_CALLS) {
      if (arity.min === 0) continue;
      expect(codes(inReducer(`t := (${name}).show`)), name).toEqual(["E0213"]);
    }
  });

  it("gives the bare spelling the sentence and the position of the written one", () => {
    // The claim both the changeset and `errors.md` make is that the parentheses
    // change nothing about what is reported, and `codes` cannot see that. The
    // position is the part that could quietly differ: the parser builds the
    // call from the *qualifier* token, so the caret has to land on `Duration`
    // either way rather than on the member.
    const bare = check(parse(lex(inReducer("t := (Duration.s).show"))));
    expect(bare).toEqual([
      {
        code: "E0213",
        kind: "call-arity-mismatch",
        message: 'Function "Duration.s" expects 1 argument(s) but got 0',
        pos: { line: 4, col: 36 },
      },
    ]);
    expect(check(parse(lex(inReducer("t := (Duration.s()).show"))))).toEqual(bare);
    expect(check(parse(lex(inReducer("t := (Duration.nope).show"))))).toEqual([
      {
        code: "E0116",
        kind: "undef-call",
        message: 'Call to undefined function "Duration.nope"',
        pos: { line: 4, col: 36 },
      },
    ]);
  });

  it("reports it in a fn body too, where it used to compile", () => {
    // The successor to the half of the deleted gap test that read the emitted
    // module: `loweringOf` puts the call site in a `fn` rather than a reducer,
    // and that is where `(Duration.s).show` used to compile to a field read on
    // `{_tag: "Duration"}`. It now fails to compile at all, which is the same
    // answer from the other position.
    expect(() => loweringOf("Duration.s")).toThrow("compile failed: E0213");
    expect(() => loweringOf("Duration.nope")).toThrow("compile failed: E0116");
  });

  it("reads a keyword member the same way, in either spelling", () => {
    // `parsePrimary` accepts a `kw` token as the member so that the two
    // spellings agree — otherwise `Decoder.if` is a parse error bare and a
    // diagnostic written out. Nothing pinned that, and widening the set to four
    // namespaces widened the path.
    for (const where of ["Decoder.if", "Duration.if", "Bytes.if"]) {
      expect(codes(inReducer(`t := (${where}).show`)), where).toEqual(["E0116"]);
    }
    expect(codes(inReducer("t := (Decoder.if(a)).show"))).toEqual(["E0116"]);
  });

  it("claims the qualifier position and not the name", () => {
    // The parser reads this set without consulting the type table, so listing
    // `Duration` claims `Duration.<member>` in every position. What it does not
    // claim is the name: a program that declares its own `type Duration` writes
    // its tags as bare names, which is a different position, and reads its
    // values through a lowercase receiver, which is postfix parsing. Pinned
    // because a set the parser applies by spelling alone is the kind of change
    // that takes a name away from the programs that already had it.
    const src = `type Duration = Short | Long
slot d : Duration = Short
slot t : Text = ""
reducer pick on=ui.click(B) do= d := Long
tile B = button(text="b")
tile App = column(B, text(t), text(d.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(codes(src)).toEqual([]);
  });

  it("leaves a listed name usable as a value and as a pattern", () => {
    // The risk the issue named. `parsePrimary` reaches this set before the
    // capitalised-bare-identifier fallback that builds a `Variant`, and the
    // only thing between them is the `matchOp(".")` guard — so a listed name
    // written on its own, or matched, has to stay the tag it was. Nothing else
    // in this file would notice if that guard were relaxed, and the set is now
    // four names wide rather than two.
    const src = `type Span = Duration | Instant
slot p : Span = Duration
slot t : Text = ""
reducer flip on=ui.click(B) do= t := match p with | Duration -> "d" | Instant -> "i"
tile B = button(text="b")
tile App = column(B, text(t))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(codes(src)).toEqual([]);
  });

  it("reports a bare member the namespace does not declare by name", () => {
    // The other half of the promotion. As a field read this was `undefined`
    // with no diagnostic at all; as a call it is a name that resolves to
    // nothing, which is what E0116 says.
    expect(codes(inReducer("t := (Duration.nope).show"))).toEqual(["E0116"]);
    expect(codes(inReducer("t := (Bytes.from-json).show"))).toEqual(["E0116"]);
  });

  it("a member of a listed namespace is only what the table lists", () => {
    // `TYPE_MEMBER_CALLS` resolves `fresh` / `parse` / `show` on any capitalised
    // qualifier, and that reached inside these namespaces: `EffectId.fresh`
    // passed and lowered to `_s.freshId()`, minting a real id where the author
    // wrote the empty sentinel — and a later `http.cancel` on it cancels
    // nothing. `Duration.fresh()` is the same defect on the two names this
    // carve-out has just grown by: a UUID written into a `Duration` slot.
    //
    // The rule is the count and the namespace rather than the parentheses, so
    // both spellings are checked. `docs/spec/errors.md` E0117 records it.
    for (const namespace of QUALIFIED_CALL_NAMESPACES) {
      for (const member of TYPE_MEMBER_CALLS.keys()) {
        const where = `${namespace}.${member}`;
        expect(codes(inReducer(`t := (${where}).show`)), where).toEqual(["E0116"]);
        expect(codes(inReducer(`t := (${where}()).show`)), `${where}()`).toEqual(["E0116"]);
      }
    }
  });

  it("still accepts a type member that was given its argument", () => {
    // `EffectId.show(h)` is the qualified spelling of `h.show`; only the
    // zero-argument form is refused above.
    expect(codes(inReducer("t := EffectId.show(a)"))).toEqual([]);
  });

  for (const [name, sentinel] of Object.entries(SENTINEL)) {
    // `Decoder.Json` is the one member of these namespaces that carries
    // something — the payload type — so it is the one with no paren-less
    // spelling. The two directions of that are pinned below.
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
    // `docs/spec/http.md` §6.1.4 writes `Decoder.Json(User)` every time, and
    // the type is what makes the decode type-safe. Written bare it read as a
    // decoder that had one and lowered identically, so the omission was
    // invisible in the source and in the output.
    expect(codes(inReducer("t := (Decoder.Json).show"))).toEqual(["E0213"]);
    expect(codes(inReducer("t := (Decoder.Json(Text)).show"))).toEqual([]);
  });

  it("reports a misspelt member of a listed namespace", () => {
    // Without the parser reading these, `Decoder.Nope` was a field read on a
    // variant: accepted by `check`, emitted as `undefined`.
    expect(codes(inReducer("t := (Decoder.Nope).show"))).toEqual(["E0116"]);
    expect(codes(inReducer("t := (EffectId.nope).show"))).toEqual(["E0116"]);
  });

  it("still reports one written with parentheses", () => {
    expect(codes(inReducer("t := (Decoder.Nope(Text)).show"))).toEqual(["E0116"]);
  });

  it("accepts the constants themselves", () => {
    // Green before this change too — a field read draws no diagnostic either.
    // It earns its place as the other side of the rule above: a check that
    // refuses every other member of these namespaces must not refuse these.
    expect(codes(inReducer("t := (Decoder.None).show"))).toEqual([]);
    expect(codes(inReducer("t := (EffectId.none).show"))).toEqual([]);
  });
});

describe("every built-in is held to the count its lowering reads", () => {
  // Generated from the tables rather than written out, so a builtin cannot be
  // added without a case: the arity lives beside the name, and this walks both.
  //
  // The call is wrapped in `.show` so the result type never decides the
  // outcome — what is under test is the count, and a `Duration` assigned to an
  // `Int` slot would otherwise add a second diagnostic to half the cases.

  /** An argument no builtin's lowering objects to. */
  const FILLER = "1";

  /** `fresh` / `parse` / `show` resolve on any capitalised qualifier. */
  const QUALIFIER = "Probe";

  const args = (n: number) => Array.from({ length: n }, () => FILLER).join(", ");

  function callOf(name: string): (n: number) => string {
    const spelling = TYPE_MEMBER_CALLS.has(name) ? `${QUALIFIER}.${name}` : name;
    return (n) => `${spelling}(${args(n)})`;
  }

  const ALL: [string, BuiltinArity][] = [
    ...BUILTIN_CALLS,
    ...QUALIFIED_BUILTIN_CALLS,
    ...TYPE_MEMBER_CALLS,
  ];

  /**
   * `now` is a keyword, so the parser builds its zero-argument call itself and
   * there is no way to write another count. The arity in the table is what
   * `checkCallee` would hold it to if the spelling ever loosened.
   */
  const PARSER_FIXED = new Set(["now"]);

  const NAMED = ALL.filter(([name]) => !PARSER_FIXED.has(name));

  it("covers all three tables", () => {
    expect(ALL.length).toBe(
      BUILTIN_CALLS.size + QUALIFIED_BUILTIN_CALLS.size + TYPE_MEMBER_CALLS.size,
    );
    expect([...PARSER_FIXED].every((n) => BUILTIN_CALLS.has(n))).toBe(true);
  });

  /**
   * What each builtin takes, written out rather than read from the table the
   * cases above are generated from. Generated cases prove the checker enforces
   * whatever the table says; this proves the table says what the spec does —
   * without it, widening an entry deletes its own cases instead of failing
   * them, because a builtin that takes any number of arguments has neither a
   * count that is too few nor one that is too many.
   */
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
    expect(codes(inReducer("t := now.show"))).toEqual([]);
    expect(() => parse(lex(inReducer("t := now(1).show")))).toThrow(/Expected/);
  });

  for (const [name, arity] of NAMED) {
    const call = callOf(name);

    it(`${name} accepts ${arity.min}`, () => {
      expect(codes(inReducer(`t := (${call(arity.min)}).show`))).toEqual([]);
    });

    if (arity.min > 0) {
      it(`${name} reports one argument too few`, () => {
        expect(codes(inReducer(`t := (${call(arity.min - 1)}).show`))).toEqual(["E0213"]);
      });
    }

    if (Number.isFinite(arity.max)) {
      it(`${name} reports one argument too many`, () => {
        expect(codes(inReducer(`t := (${call(arity.max + 1)}).show`))).toEqual(["E0213"]);
      });
    }
  }
});

describe("codegen no longer supplies what the call omitted", () => {
  // The lowerings read `args[0]` and substituted `0` / `""` / `[]` / `undefined`
  // when it was absent, which is how a missing argument became a plausible
  // value. `checkCallee` reports E0213 wherever `checkExpr` walks, and the
  // throw is what remains for a caller that reaches codegen without it — every
  // case below calls `codegen` directly, which is that path.
  //
  // The list is derived rather than written: a builtin that requires an
  // argument gets its check case from the tables above, and would otherwise
  // get no throw case at all.
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
        // The one name whose call must supply something its lowering never
        // reads. Nothing throws, so the count is the only thing standing
        // between a decoder with a payload type and one without.
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
    // These four expressions went unwalked, so `checkCallee` never saw a call
    // in one: `check` reported ok and the codegen throw was the whole of what
    // the author got. On the defaulting side it was worse — the app built,
    // with a request timeout of zero. They are walked now, so this is a
    // diagnostic at the field like any other position.
    const inHttpField = `slot t : Text = ""
tile App = column(text(t))
app A caps=[http.get]
    routes={"/" -> App, "/404" -> App}
    http={base-url: "https://x", timeout: Duration.s()}
    init=[]
`;
    expect(check(parse(lex(inHttpField)))).toEqual([
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
  // Codegen matches `<Q>.fresh|parse|show` by regex, so any capitalised name
  // resolved — and a misspelling did not fail, it *changed the lowering*.
  // `Int.parse` has a numeric branch; `Itn.parse` misses it and takes the
  // generic string one, so a slot declared `Int` ends up holding `"12"` and
  // every later arithmetic operation on it concatenates.

  it("reports a qualifier that names no type", () => {
    expect(check(parse(lex(inReducer('t := Itn.parse(t).get-or("")'))))).toEqual([
      {
        code: "E0117",
        kind: "undef-type",
        message: 'Reference to undefined type "Itn"',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("accepts the primitives, which are not in the type table", () => {
    // `Int` / `Float` / `Time` / `EffectId` are `TypePrim` in the grammar, so
    // they never reach `sym.types` — resolving the qualifier against that table
    // alone would reject the calls the standard library is written in terms of.
    expect(codes(inReducer("a := Int.parse(t).get-or(0)"))).toEqual([]);
    expect(codes(inReducer("t := Float.parse(t).get-or(0.0).show"))).toEqual([]);
    expect(codes(inReducer("t := Time.show(a)"))).toEqual([]);
    expect(codes(inReducer("t := EffectId.show(a)"))).toEqual([]);
  });

  it("accepts a type the program declares, and a standard-library one", () => {
    expect(codes(inReducer("t := Probe.fresh()"))).toEqual([]);
    expect(codes(inReducer("t := Url.show(a)"))).toEqual([]);
  });

  it("leaves an unknown member to E0116, which is a different mistake", () => {
    // A member outside the table is not a lowering at all, so the qualifier is
    // beside the point: `Whatever.frish()` is one diagnostic, not two.
    expect(codes(inReducer("t := Whatever.frish()"))).toEqual(["E0116"]);
    expect(codes(inReducer("t := Probe.frish()"))).toEqual(["E0116"]);
  });

  it("reports a namespace that is not a type either", () => {
    // `Decoder` names a set of constants, not a type, and `Decoder.parse(x)`
    // lowered to a parse of `x` — the qualifier read as decoration.
    expect(codes(inReducer('t := Decoder.parse(t).get-or("")'))).toEqual(["E0117"]);
  });

  it("keeps a qualified E0116's message shape readable too", () => {
    // The repair for a misspelt *member* is built from the qualifier the author
    // wrote, and `kumiki fix` gets both halves out of this sentence: the name
    // to replace, and the position to splice at.
    expect(check(parse(lex(inReducer("a := Int.pasre(t).get-or(0)"))))).toEqual([
      {
        code: "E0116",
        kind: "undef-call",
        message: 'Call to undefined function "Int.pasre"',
        pos: { line: 4, col: 35 },
      },
    ]);
  });

  it("keeps the message shape a repair can read", () => {
    // `kumiki fix` parses the first quoted name out of an E0117 and suggests
    // from the type namespace — the same sentence `resolveType` produces, so
    // the repair path is inherited rather than rebuilt.
    const [err] = check(parse(lex(inReducer('t := Itn.parse(t).get-or("")'))));
    expect(err?.message).toMatch(/^Reference to undefined type "[^"]+"$/);
  });
});

describe("the result type of a qualified `show`", () => {
  // `T.show(v)` is the qualified spelling of `v.show`. Codegen lowers both to
  // the same `_s.show(v)` for every capitalised `T` — one regex, one helper,
  // always a `Text` — and `inferType` did not agree for every `T`: its `Call`
  // case answered `Duration.*` with `Duration` and `Bytes.*` with `Bytes`
  // before the member was consulted at all, so those two qualifiers returned
  // the constructor's type for a call that constructs nothing.
  //
  //     shown := Duration.show(ms)
  //     E0201 type-mismatch at 3:40: Expected Text but got Duration
  //
  // That is the expensive direction: a program the runtime runs, refused, with
  // no spelling of it left for the author — `ms.show` is the method, not this.
  // `fresh` and `parse` are deliberately not here: their result *is* the
  // qualifier's, so the qualifier answering for them is correct (#344).
  const QUALIFIERS = [
    // The primitives, which never reach `sym.types`.
    "Int",
    "Float",
    "Time",
    "EffectId",
    // The standard library's types, including the two the qualifier used to
    // answer for.
    "Duration",
    "Bytes",
    "Url",
    // A type the program declares.
    "Probe",
  ];

  it("is Text for every qualifier, so a Text target accepts it", () => {
    for (const q of QUALIFIERS) {
      expect(codes(inReducer(`t := ${q}.show(a)`)), q).toEqual([]);
    }
  });

  it("is Text rather than undecidable, so a non-Text target still refuses it", () => {
    // Without this the first assertion is satisfied by answering `null`, which
    // is accepted against *every* target — trading a wrong diagnostic for no
    // diagnostic at all. `a` is the `Int` slot.
    for (const q of QUALIFIERS) {
      expect(codes(inReducer(`a := ${q}.show(a)`)), q).toEqual(["E0201"]);
    }
  });

  it("names Text in the diagnostic, whichever qualifier was written", () => {
    for (const q of QUALIFIERS) {
      const [err] = check(parse(lex(inReducer(`a := ${q}.show(a)`))));
      expect(err?.message, q).toBe("Expected Int but got Text");
    }
  });

  it("lowers to the one helper, whichever qualifier was written", () => {
    // The checker's answer is only right because the lowering discards the
    // qualifier. Pinned here so the two cannot drift apart silently.
    for (const q of QUALIFIERS) {
      expect(loweringOf(`${q}.show(1)`), q).toContain("_s.show(1)");
    }
  });

  it("still answers a Duration / Bytes constructor with its own type", () => {
    // The branches the fix reorders around: these *do* construct, and their
    // result is the qualifier's.
    expect(codes(inReducer("t := Duration.ms(500)"))).toEqual(["E0201"]);
    expect(codes(inReducer("t := Bytes.from-text(t)"))).toEqual(["E0201"]);
  });
});
