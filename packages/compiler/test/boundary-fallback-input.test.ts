import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// An `error-boundary` fallback is applied to the panic: codegen binds its `$1`
// to the `PanicInfo` the runtime builds, whatever the fallback declares
// (lifecycle.md §7.3). A fallback declaring `in=Text` passed `check` and
// `smoke` alike and rendered `recovered: [object Object]` — the checker typed
// `$1` as the `Text` it said, and the value was a record. One declaring no
// `in=` drew E0103's generic hint for its `$1`, and following that hint led to
// the first shape.
//
// E0220 is the diagnostic for both, at the `error-boundary` clause. A fallback
// that declares no `in=` and never reads `$1` is left alone: it is a tile that
// renders with nothing, which a route or sub-route target has to be (E0213).

const program = (fallbackIn: string, body = `column(text("recovered"))`): string =>
  `slot secret : Option(Text) = None
tile Fb ${fallbackIn} = ${body}
tile Risky error-boundary=Fb = column(text("v: " + secret.get))
tile Home = column(Risky)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]`;

const diagnostics = (src: string) =>
  check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

// Order-free: which diagnostic comes first follows definition order, not a rule.
const codeSet = (src: string) => [...new Set(check(parse(lex(src))).map((e) => e.code))].sort();

describe("an error-boundary fallback takes a PanicInfo", () => {
  it("a fallback declaring another in= is E0220 at the clause", () => {
    expect(diagnostics(program("in=Text", `column(text("recovered: " + $1))`))).toEqual([
      'E0220 3:27 Tile "Risky" uses "Fb" as its error-boundary, which declares in=Text — a fallback is applied to the panic, so it receives a PanicInfo as $1 and must declare in=PanicInfo',
    ]);
  });

  it("a fallback declaring no in= that reads $1 is E0220 beside E0103, naming PanicInfo", () => {
    const src = program("", `column(text("x: " + $1))`);
    expect(codeSet(src)).toEqual(["E0103", "E0220"]);
    expect(diagnostics(src)).toContain(
      'E0220 3:27 Tile "Risky" uses "Fb" as its error-boundary, which declares no in= but reads $1 — a fallback is applied to the panic, so it receives a PanicInfo as $1 and must declare in=PanicInfo',
    );
  });

  it("a fallback declaring no in= and never reading $1 is not reported", () => {
    expect(diagnostics(program(""))).toEqual([]);
  });

  it("a $1 bound by a method call's implicit argument is not the fallback reading the panic", () => {
    // The `$1` inside `.map(…)` is the element, bound by the call — E0103 does
    // not fire on it, and neither does E0220.
    const body = `column(text(["a"].map($1 + "!").join(", ")))`;
    expect(diagnostics(program("", body))).toEqual([]);
  });

  it("a $1-free fallback with no in= can still be a route target", () => {
    const src = `tile Fallback = column(text("something went wrong"))
slot secret : Option(Text) = None
tile Risky error-boundary=Fallback = column(text("v: " + secret.get))
tile Home = column(Risky)
app M caps=[] routes={"/" -> Home, "/oops" -> Fallback, "/404" -> Home} init=[]`;
    expect(diagnostics(src)).toEqual([]);
  });

  it("a $1-free fallback with no in= can still be a sub-route target", () => {
    const src = `tile Fallback = column(text("something went wrong"))
slot secret : Option(Text) = None
tile Risky error-boundary=Fallback = column(text("v: " + secret.get))
tile Shell sub-routes={"/oops" -> Fallback, "/risky" -> Risky} = column(route-outlet())
tile Home = column(text("home"))
app M caps=[] routes={"/" -> Home, "/s/*" -> Shell, "/404" -> Home} init=[]`;
    expect(diagnostics(src)).toEqual([]);
  });

  it("in=PanicInfo is accepted, and so is an alias, a nominal over it, or its five fields", () => {
    // Five boundaries in one program: only the one whose fallback declares
    // something else is reported.
    const src = `type Crash = PanicInfo
type Wrapped = nominal PanicInfo
tile Good    in=PanicInfo = column(text("good: " + $1.message))
tile Aliased in=Crash     = column(text("aliased: " + $1.location))
tile Nominal in=Wrapped   = column(text("nominal"))
tile Spelled in={message: Text, location: Text, episode-id: Option(Text), cause: Option(Text), category: Text} = column(text("spelled: " + $1.category))
tile Wrong   in=Text      = column(text("wrong: " + $1))
tile A error-boundary=Good    = column(text("a"))
tile B error-boundary=Aliased = column(text("b"))
tile C error-boundary=Nominal = column(text("c"))
tile D error-boundary=Spelled = column(text("d"))
tile E error-boundary=Wrong   = column(text("e"))
tile Home = column(A, B, C, D, E)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`)).toEqual([
      "E0220 12:23",
    ]);
  });

  it("a record narrower than PanicInfo is E0220 — there is no width subtyping", () => {
    expect(
      diagnostics(program("in={message: Text}", `column(text("recovered: " + $1.message))`)),
    ).toEqual([
      'E0220 3:27 Tile "Risky" uses "Fb" as its error-boundary, which declares in={message: Text} — a fallback is applied to the panic, so it receives a PanicInfo as $1 and must declare in=PanicInfo',
    ]);
  });

  it("an in= naming no type is E0117 alone", () => {
    // `assignable` accepts an unresolved name on either side, so the misspelling
    // is E0117's to report and E0220 does not pile on.
    expect(codeSet(program("in=Nope", `column(text("recovered: " + $1))`))).toEqual(["E0117"]);
  });

  it("the report is attached to the clause, not to the tile", () => {
    // Two clauses naming the same fallback are two reports, one per clause.
    const src = `tile Fb in=Text = column(text($1))
tile A error-boundary=Fb = column(text("a"))
tile B error-boundary=Fb = column(text("b"))
tile Home = column(A, B)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`)).toEqual([
      "E0220 2:23",
      "E0220 3:23",
    ]);
  });
});
