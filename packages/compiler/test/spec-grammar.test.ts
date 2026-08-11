// The grammar `docs/spec/language.md` writes down, against the one the lexer
// and parser accept.
//
// `docs/spec/` is normative, so a construct it defines and the implementation
// rejects is a bug in the implementation — unless the construct has no meaning
// to give, in which case the spec is what moves. Each block below says which.

import { check, compile, lex, parse } from "@kumikijs/compiler";
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

/** The diagnostics themselves, for a test that reads a message or a position. */
const diags = (src: string) => check(parse(lex(src)));
const codes = (src: string) => diags(src).map((e) => e.code);

describe("comments and the selector #", () => {
  // `#` is the one context-sensitive character in the lexer. The rule: it is
  // the selector operator only when the character before it ends a value — an
  // identifier character or a closing bracket — and the character after it
  // begins an identifier. Everything else starts a comment, so a `#` with a
  // space in front of it or after it is always a comment.
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

  it("needs an identifier START after it, which is what a #id fragment is", () => {
    // The two sides use different predicates, and only this pins the second:
    // `4` continues an identifier but cannot begin one, so `Btn#4` is a
    // comment — which agrees with `tile-ref`, whose id is an identifier.
    expect(
      lex("Btn#4")
        .filter((t) => t.kind !== "eof")
        .map((t) => t.kind),
    ).toEqual(["ident"]);
    expect(
      lex("Btn#_x")
        .filter((t) => t.kind !== "eof")
        .map((t) => t.kind),
    ).toEqual(["ident", "op", "ident"]);
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

  it("stays quiet when a declared name is one edit away", () => {
    // `page-size` beside a `page-sizes` is a misspelling, not arithmetic, and
    // `kumiki fix` reads the message as a contract — proposing spaces there is
    // the one repair that cannot be right.
    const err = diags(
      `slot page : Int = 1
slot page-sizes : Int = 2
fn f() -> Int = page-size${APP}`,
    ).find((e) => e.code === "E0103");
    expect(err?.message).toBe('Reference to undefined name "page-size"');
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

  it("reads the escape as a code point, not as a UTF-16 unit", () => {
    // The astral half is the reason the `{...}` form exists: `\u{1F600}` is one
    // character, and `fromCharCode` would truncate it to U+F600.
    const program = parse(lex(`slot s : Text = "\\u{1F600}"${APP}`));
    const slot = program.defs.find((d) => d.kind === "SlotDef");
    if (slot?.kind !== "SlotDef" || slot.init.kind !== "Str") throw new Error("no slot in fixture");
    expect(slot.init.value).toBe("\u{1F600}");
  });

  it("rejects a malformed escape as a lex error, with a position", () => {
    // Not merely "throws": letting `parseInt` produce NaN and `fromCodePoint`
    // throw a bare RangeError loses the position, which is the whole reason to
    // report it here. `\\u{110000}` is past the last code point and `\\u{D800}`
    // is half of one — both make a string no encoder can write, and finding
    // out at the encoder is finding out in the wrong place.
    for (const bad of ["\\u{}", "\\u{2713", "\\u{zz}", "\\u2713", "\\u{110000}", "\\u{D800}"]) {
      expect(outcome(`slot s : Text = "${bad}"${APP}`)[0], bad).toContain("Lex error at");
    }
  });
});

describe("what a tuple lowers to", () => {
  it("is the array a tuple pattern destructures", () => {
    // `tupleArm` guards with `Array.isArray` and reads by index, so the two
    // halves have to agree on the shape — and nothing else reaches the
    // generated code for a tuple.
    const out = compile(`fn pair(a: Int, b: Text) -> Tuple(Int, Text) = (a, b)${APP}`, {});
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.js).toContain("[a, b]");
  });
});

describe("file-level input", () => {
  it("skips a byte-order mark", () => {
    clean(`﻿slot s : Int = 0${APP}`);
  });
});

describe("definitions are unordered", () => {
  // §1.1: "Definitions are unordered." `isAppEnd` stopped only at a keyword or
  // EOF, and `theme` / `motion` are the two definition heads that are not
  // reserved words — `theme = T` is also an `app` clause — so an `app` written
  // first ate either one as a clause of its own.
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
    expect(err).toContain("Retry count must be a whole number, 0 or more");
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
    const line = `effect load cap=http.get in=Unit out=Result(Text, Text) retry=linear(3, 100xy)`;
    const err = outcome(`${line}
${APP}`)[0];
    expect(err).toContain("Unknown duration unit");
    // At the unit itself. It used to point one token past it, at the `)`.
    // Derived from the fixture, so a space added to it does not break this.
    expect(err).toContain(`1:${line.indexOf("xy") + 1}`);
  });

  it("says what is wrong with a float that has no digits after the point", () => {
    expect(outcome(`slot s : Float = 1. + 2.0${APP}`)[0]).toContain("1.0");
    // The end of a line is where this actually gets written, and there the
    // next line's first token reads as the member name — so the error used to
    // surface a line later as `Expected a definition keyword`.
    expect(outcome(`slot s : Float = 1.${APP}`)[0]).toContain("1.0");
  });
});

describe("a tuple's arity is its type", () => {
  // Unlike a list, whose length is not in its type. `assignable` compares a
  // `TypeApp`'s arguments pairwise and treats a missing one as agreeing, which
  // is right for `List(Int)` and silent here — and the silence reaches the
  // runtime: a tuple pattern guards on `length`, so a mismatched literal makes
  // every arm fail and writes `undefined` into the slot.
  it("reports a literal with too many items", () => {
    const err = diags(`slot p : Tuple(Int, Int) = (1, 2, 3)${APP}`).find((d) => d.code === "E0201");
    expect(err?.message).toContain("tuple of 3 item(s)");
  });

  it("reports a literal with too few", () => {
    const err = diags(`slot p : Tuple(Int, Int, Int) = (1, 2)${APP}`).find(
      (d) => d.code === "E0201",
    );
    expect(err?.message).toContain("tuple of 2 item(s)");
  });

  it("reports one at a call site too, not only at a declaration", () => {
    const src = `fn f(p: Tuple(Int, Text)) -> Int = 1\nslot s : Int = f((1, "a", 2))${APP}`;
    expect(codes(src)).toContain("E0201");
  });

  it("names the item whose type is wrong, not the whole tuple", () => {
    const found = diags(`slot p : Tuple(Int, Text) = ("a", 1)${APP}`).filter(
      (d) => d.code === "E0201",
    );
    expect(found.map((d) => `${d.pos.col} ${d.message}`)).toEqual([
      "30 Expected Int but got Text",
      "35 Expected Text but got Int",
    ]);
  });

  it("accepts one that matches", () => {
    clean(`slot p : Tuple(Int, Text) = (1, "a")${APP}`);
  });
});

describe("a duration is a length of time", () => {
  // §1.2 makes the sign part of a number literal, so the grammar admits `-1s`
  // and the meaning is what rejects it. The runtime reads every one of these as
  // a delay and clamps a negative to the minimum, so `on=timer(-1s)` would fire
  // a once-a-second reducer hundreds of times a second.
  const negative: [string, string][] = [
    ["a timer trigger", `slot n : Int = 0\nreducer tick on=timer(-1s) do= n := n + 1${APP}`],
    [
      "a debounce policy",
      `effect e cap=http.get in=Text out=Result(Text, Text) policy=debounce(-1ms)${APP}`,
    ],
    [
      "a throttle policy",
      `effect e cap=http.get in=Text out=Result(Text, Text) policy=throttle(-1s)${APP}`,
    ],
    [
      "a retry backoff",
      `effect e cap=http.get in=Unit out=Result(Text, Text) retry=linear(3, -100ms)${APP}`,
    ],
  ];
  for (const [what, src] of negative) {
    it(`rejects a negative duration in ${what}`, () => {
      expect(outcome(src)[0]).toContain("Duration must be 0 or more");
    });
  }

  it("rejects a retry count that is not a whole number", () => {
    const err = outcome(
      `effect e cap=http.get in=Unit out=Result(Text, Text) retry=linear(2.5, 100ms)${APP}`,
    )[0];
    expect(err).toContain("Retry count must be a whole number");
  });

  it("rejects a backoff factor that cannot grow", () => {
    const err = outcome(
      `effect e cap=http.get in=Unit out=Result(Text, Text) retry=exponential(3, 100ms, -2.0)${APP}`,
    )[0];
    expect(err).toContain("Retry factor must be greater than 0");
  });

  it("still accepts the durations a program actually writes", () => {
    clean(`slot n : Int = 0\nreducer tick on=timer(1s) do= n := n + 1${APP}`);
    clean(
      `effect e cap=http.get in=Unit out=Result(Text, Text) retry=exponential(3, 100ms, 2.0)${APP}`,
    );
  });
});

describe("a panic carries one thing out of the program", () => {
  const panicking = (arg: string) => `slot n : Int = 0
tile B = button(text="b", onClick=r)
tile App2 = column(B)
reducer r on=ui.click(B) do= panic(${arg})
app A caps=[] routes={"/" -> App2, "/404" -> App2} init=[]
`;

  it("requires the message to be Text", () => {
    // The runtime stringifies it, so a record arrives as "[object Object]" —
    // the stop reason lost at exactly the moment it is needed.
    expect(codes(panicking("42"))).toContain("E0201");
    expect(codes(panicking("{code: 1}"))).toContain("E0201");
  });

  it("accepts a Text message", () => {
    clean(panicking('"unreachable"'));
  });
});

describe("input the lexer has to survive", () => {
  it("counts a byte-order mark as a column, so a patch splices the right place", () => {
    // A BOM is not part of the text, but it IS part of the string every
    // consumer of a position splices at `column - 1`. Skipping the index
    // without advancing the column left line 1 one short.
    const [tok] = lex("\uFEFFslot");
    expect(tok?.pos).toEqual({ line: 1, col: 2 });
  });

  it("ends a `$` binding at a hyphen the same way a name does", () => {
    // Two identifier forms, one rule: `$el- 1` must not become a binding
    // named `$el-`.
    expect(
      lex("$1- 1")
        .filter((t) => t.kind !== "eof")
        .map((t) => `${t.kind}:${"value" in t ? t.value : ""}`),
    ).toEqual(["ident:$1", "op:-", "num:1"]);
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
