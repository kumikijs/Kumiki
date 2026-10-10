import { lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { compileOrFail } from "./helpers/module.ts";

const APP = `
tile App = column(text("hi"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

/** Diagnostics, or the parse/lex error as a single `THROW <message>` entry. */
function outcome(src: string, capabilities: string[] = []): string[] {
  try {
    return checkSource(src, { capabilities }).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`);
  } catch (e) {
    return [`THROW ${(e as Error).message}`];
  }
}

const clean = (src: string, capabilities: string[] = []) =>
  expect(outcome(src, capabilities)).toEqual([]);

describe("comments and the selector #", () => {
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
    clean(`fn f(s: Int) -> Int = s- 1${APP}`);
  });

  it("stays quiet when a declared name is one edit away", () => {
    const err = checkSource(
      `slot page : Int = 1
slot page-sizes : Int = 2
fn f() -> Int = page-size${APP}`,
    ).find((e) => e.code === "E0103");
    expect(err?.message).toBe('Reference to undefined name "page-size"');
  });

  it("says what to write when a name that reads as arithmetic resolves to nothing", () => {
    const errs = checkSource(`fn f(count: Int) -> Int = count-1${APP}`);
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
    const program = parse(lex(`slot s : Text = "\\u{1F600}"${APP}`));
    const slot = program.defs.find((d) => d.kind === "SlotDef");
    if (slot?.kind !== "SlotDef" || slot.init.kind !== "Str") throw new Error("no slot in fixture");
    expect(slot.init.value).toBe("\u{1F600}");
  });

  it("rejects a malformed escape as a lex error, with a position", () => {
    for (const bad of ["\\u{}", "\\u{2713", "\\u{zz}", "\\u2713", "\\u{110000}", "\\u{D800}"]) {
      expect(outcome(`slot s : Text = "${bad}"${APP}`)[0], bad).toContain("Lex error at");
    }
  });
});

describe("what a tuple lowers to", () => {
  it("is the array a tuple pattern destructures", () => {
    const js = compileOrFail(`fn pair(a: Int, b: Text) -> Tuple(Int, Text) = (a, b)${APP}`, {
      runtimeSpecifier: "@kumikijs/runtime",
    });
    expect(js).toContain("[a, b]");
  });
});

describe("file-level input", () => {
  it("skips a byte-order mark", () => {
    clean(`﻿slot s : Int = 0${APP}`);
  });
});

describe("definitions are unordered", () => {
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
  it("builds a tuple", () => {
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

  it("accepts a negative literal where a theme value takes a number", () => {
    const src = `theme T = {spacing: {nudge: -4, half: -0.5, flat: 0}}${APP}`;
    clean(src);
    expect(parse(lex(src)).defs[0]).toMatchObject({
      kind: "ThemeDef",
      body: { spacing: { nudge: -4, half: -0.5, flat: 0 } },
    });
  });

  it("still refuses a `-` in a theme value that is not a number's sign", () => {
    for (const value of [`-`, `-"4px"`, `-{a: 1}`, `- -4`]) {
      expect(outcome(`theme T = {spacing: {nudge: ${value}}}${APP}`), value).toEqual([
        "THROW Parse error at 1:29: Theme values must be string, number, or nested record",
      ]);
    }
  });

  it("chains `where` without a bound, as `refinement-type` being recursive says", () => {
    clean(`type Handle = nominal Text where len-gt(3) where len-lt(9) where nonempty${APP}`);
    clean(`type Bare = Text where len-gt(3) where len-lt(9) where nonempty${APP}`);
    clean(`type Rec = {tag: Text where nonempty where len-lt(9) where len-gt(1)}${APP}`);
  });

  it("reads a signed literal in a retry policy, then rejects the count for what it is", () => {
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
    clean(
      `tile App2 = column(text("hi"))
app A caps=[telemetry.out] routes={"/" -> App2, "/404" -> App2} init=[]
`,
      ["telemetry.out"],
    );
  });

  it("reads | as boolean or when a variant constructor follows it", () => {
    clean(`fn f(a: Bool) -> Bool = a | Some(1).is-some${APP}`);
  });
});

describe("diagnostics that pointed at the wrong thing", () => {
  it("reports an unknown duration unit at the unit", () => {
    const line = `effect load cap=http.get in=Unit out=Result(Text, Text) retry=linear(3, 100xy)`;
    const err = outcome(`${line}
${APP}`)[0];
    expect(err).toContain("Unknown duration unit");
    expect(err).toContain(`1:${line.indexOf("xy") + 1}`);
  });

  it("says what is wrong with a float that has no digits after the point", () => {
    expect(outcome(`slot s : Float = 1. + 2.0${APP}`)[0]).toContain("1.0");
    expect(outcome(`slot s : Float = 1.${APP}`)[0]).toContain("1.0");
  });
});

describe("a tuple's arity is its type", () => {
  it("reports a literal with too many items", () => {
    const err = checkSource(`slot p : Tuple(Int, Int) = (1, 2, 3)${APP}`).find(
      (d) => d.code === "E0201",
    );
    expect(err?.message).toContain("tuple of 3 item(s)");
  });

  it("reports a literal with too few", () => {
    const err = checkSource(`slot p : Tuple(Int, Int, Int) = (1, 2)${APP}`).find(
      (d) => d.code === "E0201",
    );
    expect(err?.message).toContain("tuple of 2 item(s)");
  });

  it("reports one at a call site too, not only at a declaration", () => {
    const src = `fn f(p: Tuple(Int, Text)) -> Int = 1\nslot s : Int = f((1, "a", 2))${APP}`;
    expect(codesOf(src)).toContain("E0201");
  });

  it("names the item whose type is wrong, not the whole tuple", () => {
    const found = checkSource(`slot p : Tuple(Int, Text) = ("a", 1)${APP}`).filter(
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
    expect(codesOf(panicking("42"))).toContain("E0201");
    expect(codesOf(panicking("{code: 1}"))).toContain("E0201");
  });

  it("accepts a Text message", () => {
    clean(panicking('"unreachable"'));
  });
});

describe("input the lexer has to survive", () => {
  it("counts a byte-order mark as a column, so a patch splices the right place", () => {
    const [tok] = lex("\uFEFFslot");
    expect(tok?.pos).toEqual({ line: 1, col: 2 });
  });

  it("ends a `$` binding at a hyphen the same way a name does", () => {
    expect(
      lex("$1- 1")
        .filter((t) => t.kind !== "eof")
        .map((t) => `${t.kind}:${"value" in t ? t.value : ""}`),
    ).toEqual(["ident:$1", "op:-", "num:1"]);
  });
});

describe("what the spec gives up instead", () => {
  it("requires an initial value for a slot", () => {
    expect(outcome(`slot s : Int${APP}`)[0]).toContain("THROW");
  });

  it("takes at most one slot modifier", () => {
    clean(`slot s : Int volatile = 0${APP}`);
    expect(outcome(`slot s : Int transient volatile = 0${APP}`)[0]).toContain("THROW");
  });

  it("has no self selector", () => {
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

  it("has no literal match pattern", () => {
    const src = `slot status : Text = "open"
fn label(s: Text) -> Text = match s with
  | "open" -> "Open"
  | "closed" -> "Closed"
tile App = text(label(status))
app T caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(outcome(src)[0]).toContain("THROW");
  });

  it("takes only key: value pairs in a props block, never a tile", () => {
    const props = `tile App = link(to="/x") {text("Home")}
app T caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(outcome(props)[0]).toContain("THROW");
    clean(`tile App = link(to="/x", text="Home")
app T caps=[] routes={"/" -> App, "/404" -> App} init=[]`);
  });

  it("gives $1 no meaning in a tile with no in=, and says to declare one", () => {
    const src = `slot items : List(Text) = []
tile Row = card(text($1))
tile App = column(for x in items Row())
app T caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    const e = checkSource(src).find((x) => x.code === "E0103");
    expect(e?.message).toContain("in=");
  });
});
