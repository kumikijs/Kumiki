// A `tile-test` applies its target: the lowering applies
// `App._tilesById[<target>]` to `given.in`. Nothing checked that the one
// argument matched the target's declaration, so a test that omitted the `in`
// its tile declares passed `undefined` and `kumiki test` died with a bare
//
//     TypeError: Cannot read properties of undefined (reading 'label')
//
// — no test name, no position, no code, and nothing catches it, so the rest of
// the file's tests lost their results with it. The mirror case was quieter and
// no better: an `in` given to a tile that declares none was dropped, and the
// snapshot compared against a render that never saw it.
//
// It is the tile-call rule applied to an applier that is not a tile expression
// (a route entry and a sub-route entry are the other two), so the messages are
// the tile form's: E0213 for the count, E0201 for the value against `in=`. The
// type half is not a refinement of the first — `show` renders an absent or
// wrongly typed value as `""`, so a mistyped `in` passes vacuously rather than
// announcing itself, one read short of the same TypeError.

import { check, codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

function diagnose(source: string): { code: string; message: string; line: number; col: number }[] {
  return check(parse(lex(source)))
    .filter((e) => e.severity !== "warning")
    .map((e) => ({ code: e.code, message: e.message, line: e.pos.line, col: e.pos.col }));
}

function codes(source: string): string[] {
  return diagnose(source).map((e) => e.code);
}

function messages(source: string): string[] {
  return diagnose(source)
    .map((e) => e.message)
    .sort();
}

/** The text at a diagnostic's own line and column, so a position is read rather than counted. */
function textAt(source: string, at: { line: number; col: number }): string {
  return (source.split("\n")[at.line - 1] ?? "").slice(at.col - 1);
}

/** A program whose `test` definitions are what is under test. */
function app(tests: string, defs = DEFS): string {
  return `${defs}

app M
    caps   = []
    routes = {"/" -> Host, "/404" -> Host}
    init   = []

${tests}`;
}

const DEFS = `slot count : Int = 0

tile Card in=Text = text($1)
tile Host = column(Card("x"))`;

describe("a tile-test supplies the argument its target declares", () => {
  it("refuses a target that declares in= and a given that has none", () => {
    const src = app(`test t =
    tile-test Card
        given  = {slots: {count: 0}}
        expect = text("x")`);
    expect(codes(src)).toEqual(["E0213"]);
    expect(messages(src)).toEqual([`Tile "Card" expects 1 argument(s) but got 0`]);
  });

  it("reports the missing argument at the test", () => {
    const src = app(`test t =
    tile-test Card
        given  = {slots: {count: 0}}
        expect = text("x")`);
    const d = diagnose(src)[0];
    expect(d && textAt(src, d)).toMatch(/^test t\b/);
  });

  it("refuses an `in` the target does not declare", () => {
    const src = app(`test t =
    tile-test Host
        given  = {slots: {count: 0}, in: "x"}
        expect = column(text("x"))`);
    expect(codes(src)).toEqual(["E0213"]);
    expect(messages(src)).toEqual([`Tile "Host" expects 0 argument(s) but got 1`]);
  });

  it("reports the unwanted `in` at the section, which is the text to delete", () => {
    const src = app(`test t =
    tile-test Host
        given  = {slots: {count: 0}, in: "x"}
        expect = column(text("x"))`);
    const d = diagnose(src)[0];
    expect(d && textAt(src, d)).toMatch(/^in: "x"/);
  });

  it("accepts the two pairings that agree", () => {
    expect(
      diagnose(
        app(`test with-in =
    tile-test Card
        given  = {slots: {}, in: "x"}
        expect = text("x")

test without-in =
    tile-test Host
        given  = {slots: {}}
        expect = column(text("x"))`),
      ),
    ).toEqual([]);
  });

  it("reports a record-typed in= whose $1.label read is the TypeError", () => {
    const src = app(
      `test t =
    tile-test Card
        given  = {slots: {count: 0}}
        expect = text("x")`,
      `slot count : Int = 0

tile Card in={label: Text} = text($1.label)
tile Host = column(Card({label: "x"}))`,
    );
    expect(messages(src)).toEqual([`Tile "Card" expects 1 argument(s) but got 0`]);
  });

  it("reads the `in` of a given written in any order", () => {
    expect(
      diagnose(
        app(`test t =
    tile-test Card
        given  = {in: "x", slots: {}}
        expect = text("x")`),
      ),
    ).toEqual([]);
  });

  it("still reports when the given names nothing at all", () => {
    expect(
      messages(
        app(`test t =
    tile-test Card
        given  = {}
        expect = text("x")`),
      ),
    ).toEqual([`Tile "Card" expects 1 argument(s) but got 0`]);
  });

  it("leaves an undefined target to E0105 alone", () => {
    expect(
      codes(
        app(`test t =
    tile-test Nope
        given  = {slots: {}}
        expect = text("x")`),
      ),
    ).toEqual(["E0105"]);
  });

  it("refuses a built-in target, which the generated test cannot apply at all", () => {
    // `_tilesById` is built from the user tiles alone, so this passed `check`
    // and then died with `App._tilesById.text is not a function` — and the
    // throw is unguarded, so the other tests in the file lost their results
    // too. The count is not what is wrong with it, so E0105 says what is.
    const src = app(`test t =
    tile-test text
        given  = {slots: {}}
        expect = text("x")`);
    expect(codes(src)).toEqual(["E0105"]);
    expect(messages(src)).toEqual([
      `Tile-test target "text" is a built-in tile — a tile-test can only name a tile the program defines`,
    ]);
  });

  it("says nothing more about a built-in target that is also given an `in`", () => {
    // One naming, one diagnostic: a built-in has no `in=` for a count to
    // disagree with, and E0105 is what the author has to fix either way.
    expect(
      codes(
        app(`test t =
    tile-test text
        given  = {slots: {}, in: "x"}
        expect = text("x")`),
      ),
    ).toEqual(["E0105"]);
  });

  it("names a `given` whose section nothing reads once — the E0714 is the mistake", () => {
    // `in: "x"` written under a name the vocabulary does not list is where the
    // argument went, so counting it absent as well is one typo reported twice,
    // at a position that stops existing as soon as the E0714 is fixed.
    const src = app(`test t =
    tile-test Card
        given  = {slots: {}, input: "x"}
        expect = text("x")`);
    expect(codes(src)).toEqual(["E0714"]);
  });

  it("reports an `in` the target does not declare whatever else the given misspells", () => {
    // The other direction has nothing to wait for: the `in` was read.
    const src = app(`test t =
    tile-test Host
        given  = {slotz: {}, in: "x"}
        expect = column(text("x"))`);
    expect(codes(src).sort()).toEqual(["E0213", "E0714"]);
  });

  it("still reports when the given is not a record at all", () => {
    // Nothing is read out of it, so the argument is as absent as the slots the
    // author meant to seed. Only the count is this rule's to answer.
    expect(
      messages(
        app(`test t =
    tile-test Card
        given  = 42
        expect = text("x")`),
      ),
    ).toEqual([`Tile "Card" expects 1 argument(s) but got 0`]);
  });

  it("says nothing about a non-record given to a target that declares no in=", () => {
    // The count agrees — none wanted, none written. That the `slots` setup is
    // dropped with it is a `given` shape question, and not this rule's.
    expect(
      diagnose(
        app(`test t =
    tile-test Host
        given  = 42
        expect = column(text("x"))`),
      ),
    ).toEqual([]);
  });

  it("checks a reducer-test's target with none of this — it has no in= to declare", () => {
    expect(
      diagnose(`slot count : Int = 0

reducer inc on=ui.click(Btn) do= count := count + 1

tile Btn = button(text="+1", onClick=inc)
tile Host = column(Btn)

app M
    caps   = []
    routes = {"/" -> Host, "/404" -> Host}
    init   = []

test t =
    reducer-test inc
        given  = {slots: {count: 0}, event: {type: ui.click, target: Btn}}
        expect = {slots: {count: 1}, effects: []}`),
    ).toEqual([]);
  });
});

describe("the `in` is compared with what the target declares", () => {
  // The count agreeing is not the argument being right. `show` renders a
  // wrongly typed value as `""` just as it renders an absent one, so before
  // this the snapshot compared against an empty string that looks like an
  // empty label — a test that passes while asserting a shape no tile call can
  // produce, `Card(42)` being an E0201 three lines away.
  it("refuses a value the target's in= does not accept", () => {
    const src = app(`test t =
    tile-test Card
        given  = {slots: {}, in: 42}
        expect = text("42")`);
    expect(codes(src)).toEqual(["E0201"]);
  });

  it("reports it at the value, which is the text to change", () => {
    const src = app(`test t =
    tile-test Card
        given  = {slots: {}, in: 42}
        expect = text("42")`);
    const d = diagnose(src)[0];
    expect(d && textAt(src, d)).toMatch(/^42/);
  });

  it("reads a record in= field by field, as a tile call's argument is read", () => {
    // `checkAgainst` is the whole of the rule, so a record answers with the
    // field codes rather than one blanket mismatch: the declared field that is
    // missing (E0214) and the written one that is not declared (E0215).
    const src = app(
      `test t =
    tile-test Card
        given  = {slots: {}, in: {name: "Ada"}}
        expect = text("Ada")`,
      `slot count : Int = 0

tile Card in={label: Text} = text($1.label)
tile Host = column(Card({label: "x"}))`,
    );
    expect(codes(src).sort()).toEqual(["E0214", "E0215"]);
  });

  it("accepts the value the target's in= does accept", () => {
    expect(
      diagnose(
        app(`test t =
    tile-test Card
        given  = {slots: {}, in: "Ada"}
        expect = text("Ada")`),
      ),
    ).toEqual([]);
  });

  it("says nothing about a value a target declaring no in= was never given", () => {
    expect(
      diagnose(
        app(`test t =
    tile-test Host
        given  = {slots: {}}
        expect = column(text("x"))`),
      ),
    ).toEqual([]);
  });

  it("refuses a `()` where the target declares a record, as a tile call does", () => {
    const src = app(
      `test t =
    tile-test Card
        given  = {slots: {}, in: ()}
        expect = text("a")`,
      `slot count : Int = 0

tile Card in={label: Text} = text($1.label)
tile Host = column(Card({label: "x"}))`,
    );
    const d = diagnose(src);
    expect(d.map((e) => `${e.code} ${e.message}`)).toEqual([
      "E0201 Expected {label: Text} but got Unit",
    ]);
    expect(d[0] && textAt(src, d[0])).toMatch(/^\(\)\}/);
  });

  it("leaves the count to E0213 rather than typing an argument that is not there", () => {
    expect(
      codes(
        app(`test t =
    tile-test Card
        given  = {slots: {}}
        expect = text("x")`),
      ),
    ).toEqual(["E0213"]);
  });
});

describe("codegen refuses what check refuses", () => {
  // The lowering used to emit `…_tilesById["Card"](undefined)`, which is the
  // TypeError with no name and no position. A caller that skipped `check` gets
  // the sentence instead, and the throw keeps this file and the checker from
  // drifting apart.
  const src = app(`test t =
    tile-test Card
        given  = {slots: {count: 0}}
        expect = text("x")`);

  it("throws rather than passing undefined as the tile's input", () => {
    expect(() =>
      codegen(parse(lex(src)), { runtimeSpecifier: "@kumikijs/runtime", includeTests: true }),
    ).toThrow(/E0213 tile-test "t": Tile "Card" expects 1 argument\(s\) but got 0/);
  });

  it("throws on the `in` a target does not declare, too", () => {
    const extra = app(`test t =
    tile-test Host
        given  = {slots: {}, in: "x"}
        expect = column(text("x"))`);
    expect(() =>
      codegen(parse(lex(extra)), { runtimeSpecifier: "@kumikijs/runtime", includeTests: true }),
    ).toThrow(/E0213 tile-test "t": Tile "Host" expects 0 argument\(s\) but got 1/);
  });

  it("lowers the agreeing pairings", () => {
    const ok = app(`test t =
    tile-test Card
        given  = {slots: {}, in: "x"}
        expect = text("x")`);
    // With the argument: `_tilesById["Card"](undefined)` contains the bare
    // call too, so the substring the buggy lowering also emitted guards
    // nothing — and the argument is the whole of what this change is about.
    expect(
      codegen(parse(lex(ok)), { runtimeSpecifier: "@kumikijs/runtime", includeTests: true }).js,
    ).toContain(`_tilesById["Card"]("x")`);
  });
});
