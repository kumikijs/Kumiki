// A `tile-test` applies its target: the lowering calls
// `App._tilesById[<target>](<given.in>)`. Nothing checked that the one
// argument matched the target's declaration, so a test that omitted the `in`
// its tile declares passed `undefined` and `kumiki test` died with a bare
//
//     TypeError: Cannot read properties of undefined (reading 'label')
//
// — no test name, no position, no code, reported by the runner as "the test
// runner threw". The mirror case was quieter and no better: an `in` given to a
// tile that declares none was dropped, and the snapshot compared against a
// render that never saw it.
//
// It is the tile-call rule (E0213) applied to the one caller that is not a
// tile expression, so the message is the tile form's.

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

  it("reports the record in= of the issue, whose $1 read is the TypeError", () => {
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

  it("does not accuse a built-in target, which declares no in= to disagree with", () => {
    expect(
      diagnose(
        app(`test t =
    tile-test text
        given  = {slots: {}}
        expect = text("x")`),
      ),
    ).toEqual([]);
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
    ).toThrow(/tile-test "t": tile "Card" expects 1 argument\(s\) but got 0/);
  });

  it("throws on the `in` a target does not declare, too", () => {
    const extra = app(`test t =
    tile-test Host
        given  = {slots: {}, in: "x"}
        expect = column(text("x"))`);
    expect(() =>
      codegen(parse(lex(extra)), { runtimeSpecifier: "@kumikijs/runtime", includeTests: true }),
    ).toThrow(/tile-test "t": tile "Host" expects 0 argument\(s\) but got 1/);
  });

  it("lowers the agreeing pairings", () => {
    const ok = app(`test t =
    tile-test Card
        given  = {slots: {}, in: "x"}
        expect = text("x")`);
    expect(
      codegen(parse(lex(ok)), { runtimeSpecifier: "@kumikijs/runtime", includeTests: true }).js,
    ).toContain(`_tilesById["Card"]`);
  });
});
