// The grammar `docs/spec/language.md` writes down, against the one the lexer
// and parser accept.
//
// `docs/spec/` is normative, so a construct it defines and the implementation
// rejects is a bug in the implementation — unless the construct has no meaning
// to give, in which case the spec is what moves. Each block below says which,
// and the PR that introduced it carries the same table.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const APP = `
tile App = column(text("hi"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

/** Diagnostics, or the parse/lex error as a single `THROW <message>` entry. */
function outcome(src: string, capabilities: string[] = []): string[] {
  try {
    return check(parse(lex(src)), { capabilities }).map(
      (e) => `${e.code} ${e.pos.line}:${e.pos.col}`,
    );
  } catch (e) {
    return [`THROW ${(e as Error).message}`];
  }
}

const clean = (src: string, capabilities: string[] = []) =>
  expect(outcome(src, capabilities)).toEqual([]);

describe("comments and the selector #", () => {
  // `#` is the one context-sensitive character in the lexer. The rule: it is
  // the selector operator only when an identifier character sits on both sides
  // of it with no whitespace between. Everything else starts a comment, so a
  // `#` with a space in front of it or after it is always a comment.
  const trailing: [string, string][] = [
    ["a number", `slot count : Int = 0# how many clicks${APP}`],
    ["a type name", `slot count : Int# what for\n = 0${APP}`],
    ["a closing paren", `slot count : Int = (1)# note${APP}`],
    ["a closing brace", `theme T = {gap: "1"}# note${APP}`],
    ["a closing bracket", `slot xs : List(Int) = [1]# note${APP}`],
    ["a string", `slot s : Text = "x"# note${APP}`],
  ];
  for (const [what, src] of trailing) {
    it(`starts a comment after ${what}`, () => clean(src));
  }

  it("starts a comment at the beginning of a line even with no space", () => {
    clean(`#TODO write this\nslot count : Int = 0${APP}`);
  });

  it("is the selector operator when identifiers sit tight on both sides", () => {
    clean(
      `slot s : Int = 0
tile B = button(text="b", onClick=r) {id: "go"}
tile App2 = column(B)
reducer r on=ui.click(B#go) do= s := 1
app A caps=[] routes={"/" -> App2, "/404" -> App2} init=[]
`,
    );
  });
});

describe("the identifier / minus ambiguity", () => {
  // `identifier ::= [a-zA-Z][a-zA-Z0-9_-]*` and `-` is also the subtraction
  // operator, and the spec gave no rule for telling them apart. It does now:
  // longest munch, with `-` continuing an identifier only when an identifier
  // character follows it. `on-401` is core syntax written exactly like
  // `count-1`, so no rule can accept one and reject the other.
  it("keeps a hyphenated name whole", () => {
    clean(`slot page-size : Int = 20${APP}`);
  });

  it("keeps a hyphen-then-digit name whole, as app.http's fields require", () => {
    clean(
      `slot n : Int = 0
reducer onUnauth on=app.start do= n := 1
tile App2 = column(text("hi"))
app A
    caps   = [http.get]
    routes = {"/" -> App2, "/404" -> App2}
    init   = []
    http   = {base-url: "/api", on-401: onUnauth}
`,
    );
  });

  it("ends the identifier at a hyphen no identifier character follows", () => {
    // `s- 1` was `Expected a definition keyword`: the identifier swallowed the
    // operator and left the `1` stranded.
    clean(`fn f(s: Int) -> Int = s- 1${APP}`);
  });

  it("says what to write when a name that reads as arithmetic resolves to nothing", () => {
    const errs = check(parse(lex(`fn f(count: Int) -> Int = count-1${APP}`)));
    const err = errs.find((e) => e.code === "E0103");
    expect(err, "no E0103").toBeDefined();
    expect(err?.message).toContain("count-1");
    expect(err?.message).toContain("count - 1");
  });
});

describe("string escapes", () => {
  it("accepts the \\u{...} escape the spec defines", () => {
    clean(`slot s : Text = "\\u{2713}"${APP}`);
  });

  it("rejects an unterminated or empty one rather than accepting a wrong character", () => {
    expect(outcome(`slot s : Text = "\\u{}"${APP}`)[0]).toContain("THROW");
    expect(outcome(`slot s : Text = "\\u{2713"${APP}`)[0]).toContain("THROW");
  });
});

describe("file-level input", () => {
  it("skips a byte-order mark", () => {
    clean(`﻿slot s : Int = 0${APP}`);
  });
});

describe("definitions are unordered", () => {
  // §1.1: "Definitions are unordered." `isAppEnd` stopped only at a keyword or
  // EOF, and `theme` / `motion` / `test` are identifiers, so an `app` written
  // first ate the next definition as one of its own clauses.
  it("accepts a theme after the app", () => {
    clean(
      `tile App2 = column(text("hi"))
app A caps=[] routes={"/" -> App2, "/404" -> App2} init=[] theme=T
theme T = {colors: {bg: "#ffffff"}}
`,
    );
  });

  it("accepts a motion after the app", () => {
    clean(
      `tile App2 = column(text("hi"))
app A caps=[] routes={"/" -> App2, "/404" -> App2} init=[]
motion Fade = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}, duration: 200}
`,
    );
  });
});

describe("expressions the spec writes but the parser rejected", () => {
  it("builds a tuple, which §1.8.4's own example matches on", () => {
    clean(
      `type LoadResult = Loading | Loaded(Int)
fn pick(lr: LoadResult, tag: Option(Text)) -> Bool
   = match (lr, tag) with
       | (Loaded(p), Some(t)) -> p > 0 | t == ""
       | (Loaded(_), None)    -> true
       | _                    -> false
${APP}`,
    );
  });

  it("accepts () in expression position", () => {
    clean(`fn nothing() -> Unit = ()${APP}`);
  });

  it("accepts a negative literal where a refinement takes literals", () => {
    clean(`type Celsius = nominal Float where between(-40.0, 60.0)${APP}`);
    clean(`type Sign = nominal Int where one-of(-1, 0, 1)${APP}`);
  });

  it("reads a signed literal in a retry policy, then rejects the count for what it is", () => {
    // `Expected num, got op(-)` described the tokens. A negative retry count
    // is not a shorter policy, it is one that cannot run, and that is what the
    // message says now.
    const err = outcome(
      `effect load cap=http.get in=Unit out=Result(Text, Text) retry=linear(-1, 100ms)
${APP}`,
    )[0];
    expect(err).toContain("Retry count must be 0 or more");
  });

  it("accepts panic as a reducer statement, which is the only place it may appear", () => {
    clean(
      `slot s : Int = 0
tile B = button(text="b", onClick=r)
tile App2 = column(B)
reducer r on=ui.click(B) do= panic("unreachable")
app A caps=[] routes={"/" -> App2, "/404" -> App2} init=[]
`,
    );
  });

  it("accepts a capability segment that collides with a reserved word", () => {
    // A registered capability, so what is under test is the grammar rather
    // than E0302. `out` is a keyword of the language and not of the
    // capability's namespace, which is why it may sit after the dot.
    clean(
      `tile App2 = column(text("hi"))
app A caps=[telemetry.out] routes={"/" -> App2, "/404" -> App2} init=[]
`,
      ["telemetry.out"],
    );
  });

  it("reads | as boolean or when a variant constructor follows it", () => {
    // `looksLikeMatchArm` accepted `| Variant(` as an arm on sight, so a
    // constructor call on the right of an or was the start of a match.
    clean(`fn f(a: Bool) -> Bool = a | Some(1).is-some${APP}`);
  });
});

describe("diagnostics that pointed at the wrong thing", () => {
  it("reports an unknown duration unit at the unit", () => {
    const err = outcome(
      `effect load cap=http.get in=Unit out=Result(Text, Text) retry=linear(3, 100xy)
${APP}`,
    )[0];
    expect(err).toContain("Unknown duration unit");
    // At the unit itself. It used to point one token past it, at the `)`.
    expect(err).toContain("1:76");
  });

  it("says what is wrong with a float that has no digits after the point", () => {
    const err = outcome(`slot s : Float = 1. + 2.0${APP}`)[0];
    expect(err).toContain("1.0");
  });
});

describe("what the spec gives up instead", () => {
  // Each of these is a grammar line with no meaning to implement. The spec is
  // what moved; these tests pin that the diagnostic is the one a reader can act
  // on rather than a silent acceptance.
  it("requires an initial value for a slot", () => {
    // `('=' init-expr)?` promised an uninitialised slot, and the language has
    // no value for one to hold: no null, no per-type zero.
    expect(outcome(`slot s : Int${APP}`)[0]).toContain("THROW");
  });

  it("takes at most one slot modifier", () => {
    // `volatile` already does everything `transient` does, so the pair says
    // nothing the second word did not.
    clean(`slot s : Int volatile = 0${APP}`);
    expect(outcome(`slot s : Int transient volatile = 0${APP}`)[0]).toContain("THROW");
  });

  it("has no self selector", () => {
    // `selector ::= tile-ref | 'self'` was the only mention anywhere. A reducer
    // is a top-level definition with no enclosing tile, so `self` names
    // nothing — accepting it would build a subscription that never fires.
    expect(
      outcome(
        `slot s : Int = 0
tile B = button(text="b", onClick=r)
tile App2 = column(B)
reducer r on=ui.click(self) do= s := 1
app A caps=[] routes={"/" -> App2, "/404" -> App2} init=[]
`,
      )[0],
    ).toContain("THROW");
  });
});
