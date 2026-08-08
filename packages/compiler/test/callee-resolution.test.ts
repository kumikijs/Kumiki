// `checkExpr`'s `Call` case walked the arguments and returned, so the callee
// was never resolved by anything. Codegen's fallback turns an unknown callee
// into a call to a JS binding of that name, which means a typo compiled, built
// and then threw `doubel is not defined` on the first interaction — the whole
// point of a name-resolution band bypassed for one expression form.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
// The tables are internal to the compiler — see `src/index.ts` for why they are
// not published — so this reaches for them directly, as `ui-lifts.test.ts` does.
import {
  BUILTIN_CALLS,
  QUALIFIED_BUILTIN_CALLS,
  TYPE_MEMBER_CALLS,
  UNIMPLEMENTED_CALLS,
} from "../src/builtin-calls.ts";

/** A program whose reducer body is `expr`, with a fn and a slot to call into. */
function inReducer(expr: string): string {
  return `slot a : Int = 0
slot t : Text = ""
fn double(x: Int) -> Int = x * 2
reducer r on=ui.click(B) do= ${expr}
tile B = button(text="b")
tile App = column(B, text(a.show), text(t))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
}

const codes = (src: string) => check(parse(lex(src))).map((e) => e.code);

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

  it("accepts a type member on any capitalised qualifier", () => {
    for (const member of TYPE_MEMBER_CALLS) {
      const arg = member === "fresh" ? "" : "t";
      expect(codes(inReducer(`t := Whatever.${member}(${arg}).show`)), member).toEqual([]);
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

  it("does not apply to built-in calls", () => {
    // A documented decision (errors.md E0213), pinned because it is the kind
    // of asymmetry a later reader would "fix" without noticing that several
    // builtins ignore their arguments outright at lowering. `Duration.s()`
    // lowering to `((0) * 1000)` is the cost, and #275 tracks it.
    expect(codes(inReducer("a := Duration.s()"))).toEqual([]);
    expect(codes(inReducer('a := Duration.s(1, 2, "x")'))).toEqual([]);
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
    expect(codes(app('toast("hello")'))).toEqual([]);
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
    fmt: 'fmt("{0}", 1)',
    panic: 'panic("x")',
    "file-url": "file-url(1)",
    "prefers-dark": "prefers-dark()",
    "EffectId.none": "EffectId.none",
    "Decoder.Json": "Decoder.Json(Text)",
    "Decoder.Text": "Decoder.Text(Text)",
    "Decoder.Bytes": "Decoder.Bytes(Text)",
    "Decoder.None": "Decoder.None(Text)",
    "Bytes.from-text": 'Bytes.from-text("x")',
    "Bytes.from-base64": 'Bytes.from-base64("x")',
    "Bytes.from-bytes": "Bytes.from-bytes([1])",
  };

  /**
   * The generated body of `fn probe`, which is where the call site lands. The
   * whole module would drag in the runtime helper prelude, whose own source
   * contains most of these names.
   */
  function loweringOf(callSite: string): string {
    const src = `slot a : Int = 0
fn probe() -> Text = (${callSite}).show
tile App = column(text(probe()))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    if (result.kind !== "ok") {
      throw new Error(`compile failed: ${result.errors.map((e) => e.code).join(", ")}`);
    }
    const body = result.js.split("\n").find((l) => l.includes("function probe"));
    if (body === undefined) throw new Error("no `function probe` in the generated module");
    return body;
  }

  const named = [...BUILTIN_CALLS, ...QUALIFIED_BUILTIN_CALLS];

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
    expect([...TYPE_MEMBER_CALLS].some((m) => named.includes(m))).toBe(false);
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

  it("a name codegen has no lowering for is not in the tables", () => {
    for (const name of UNIMPLEMENTED_CALLS) {
      expect(BUILTIN_CALLS.has(name)).toBe(false);
      expect(QUALIFIED_BUILTIN_CALLS.has(name)).toBe(false);
    }
  });
});
