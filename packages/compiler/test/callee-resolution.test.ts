// `checkExpr`'s `Call` case walked the arguments and returned, so the callee
// was never resolved by anything. Codegen's fallback turns an unknown callee
// into a call to a JS binding of that name, which means a typo compiled, built
// and then threw `doubel is not defined` on the first interaction — the whole
// point of a name-resolution band bypassed for one expression form.

import {
  BUILTIN_CALLS,
  check,
  compile,
  lex,
  parse,
  QUALIFIED_BUILTIN_CALLS,
  TYPE_MEMBER_CALLS,
  UNIMPLEMENTED_CALLS,
} from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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

describe("app.init resolves its callee as an effect", () => {
  const app = (init: string) => `slot n : Int = 0
effect load cap=storage.read in=Unit out=Result(Text, Text)
reducer got on=load.ok(_, _) do= n := 1
tile App = column(text(n.show))
app A caps=[storage.read] routes={"/" -> App, "/404" -> App} init=[${init}]
`;

  it("accepts a declared effect", () => {
    expect(codes(app("load()"))).toEqual([]);
  });

  it("reports an undefined one as E0104, not as a missing function", () => {
    // An init entry is an effect call by the grammar, so the candidate set is
    // the effect namespace — E0116 would send `kumiki fix` looking for a fn.
    expect(codes(app("looad()"))).toEqual(["E0104"]);
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

  const named = [...BUILTIN_CALLS, ...QUALIFIED_BUILTIN_CALLS].filter(
    // `run-reducer` only lowers inside a generated property-test trial, where
    // `_init` / `_event` are bound; `28-tests.kumiki` covers it end to end.
    (name) => name !== "run-reducer",
  );

  it("has a call site for every builtin in the tables", () => {
    // Duration is uniform enough to generate; the rest are listed explicitly so
    // adding a builtin forces a decision about how it is exercised here.
    const missing = named.filter((n) => !CALL_SITE[n] && !n.startsWith("Duration."));
    expect(missing).toEqual([]);
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
