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
// E0130 is the diagnostic for both, at the `error-boundary` clause.

const program = (fallbackIn: string, body = `column(text("recovered"))`): string =>
  `slot secret : Option(Text) = None
tile Fb ${fallbackIn} = ${body}
tile Risky error-boundary=Fb = column(text("v: " + secret.get))
tile Home = column(Risky)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]`;

const diagnostics = (src: string) =>
  check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

describe("an error-boundary fallback takes a PanicInfo", () => {
  it("a fallback declaring another in= is E0130 at the clause", () => {
    expect(diagnostics(program("in=Text", `column(text("recovered: " + $1))`))).toEqual([
      'E0130 3:27 Tile "Risky" uses "Fb" as its error-boundary, which declares in=Text — a fallback is applied to the panic, so it receives a PanicInfo as $1 and must declare in=PanicInfo',
    ]);
  });

  it("a fallback declaring no in= is the same diagnostic, naming PanicInfo", () => {
    expect(diagnostics(program(""))).toEqual([
      'E0130 3:27 Tile "Risky" uses "Fb" as its error-boundary, which declares no in= — a fallback is applied to the panic, so it receives a PanicInfo as $1 and must declare in=PanicInfo',
    ]);
  });

  it("in=PanicInfo is the correct shape, and so is an alias of it", () => {
    // Three boundaries in one program: only the one whose fallback declares
    // something else is reported.
    const src = `type Crash = PanicInfo
tile Good    in=PanicInfo = column(text("good: " + $1.message))
tile Aliased in=Crash     = column(text("aliased: " + $1.location))
tile Wrong   in=Text      = column(text("wrong: " + $1))
tile A error-boundary=Good    = column(text("a"))
tile B error-boundary=Aliased = column(text("b"))
tile C error-boundary=Wrong   = column(text("c"))
tile Home = column(A, B, C)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`)).toEqual([
      "E0130 7:23",
    ]);
  });

  it("the diagnostic belongs to the clause, not to the tile", () => {
    // `Fb` rendered as an ordinary tile with its `in=` supplied is fine; only
    // the boundary position fixes what `$1` is. Two boundaries naming it are
    // two reports, one per clause.
    const src = `tile Fb in=Text = column(text($1))
tile A error-boundary=Fb = column(Fb("ok"))
tile B error-boundary=Fb = column(text("b"))
tile Home = column(A, B)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]`;
    expect(check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`)).toEqual([
      "E0130 2:23",
      "E0130 3:23",
    ]);
  });
});
