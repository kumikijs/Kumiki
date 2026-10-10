import { codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { errorCodesOf, errorsOf, locatedOf, messagesOf, textAt } from "./helpers/diagnostics.ts";

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
    expect(errorCodesOf(src)).toEqual(["E0213"]);
    expect(messagesOf(src, { warnings: false })).toEqual([
      `Tile "Card" expects 1 argument(s) but got 0`,
    ]);
  });

  it("reports the missing argument at the test", () => {
    const src = app(`test t =
    tile-test Card
        given  = {slots: {count: 0}}
        expect = text("x")`);
    const d = locatedOf(src, { warnings: false })[0];
    expect(d && textAt(src, d)).toMatch(/^test t\b/);
  });

  it("refuses an `in` the target does not declare", () => {
    const src = app(`test t =
    tile-test Host
        given  = {slots: {count: 0}, in: "x"}
        expect = column(text("x"))`);
    expect(errorCodesOf(src)).toEqual(["E0213"]);
    expect(messagesOf(src, { warnings: false })).toEqual([
      `Tile "Host" expects 0 argument(s) but got 1`,
    ]);
  });

  it("reports the unwanted `in` at the section, which is the text to delete", () => {
    const src = app(`test t =
    tile-test Host
        given  = {slots: {count: 0}, in: "x"}
        expect = column(text("x"))`);
    const d = locatedOf(src, { warnings: false })[0];
    expect(d && textAt(src, d)).toMatch(/^in: "x"/);
  });

  it("accepts the two pairings that agree", () => {
    expect(
      errorsOf(
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
    expect(messagesOf(src, { warnings: false })).toEqual([
      `Tile "Card" expects 1 argument(s) but got 0`,
    ]);
  });

  it("reads the `in` of a given written in any order", () => {
    expect(
      errorsOf(
        app(`test t =
    tile-test Card
        given  = {in: "x", slots: {}}
        expect = text("x")`),
      ),
    ).toEqual([]);
  });

  it("still reports when the given names nothing at all", () => {
    expect(
      messagesOf(
        app(`test t =
    tile-test Card
        given  = {}
        expect = text("x")`),
        { warnings: false },
      ),
    ).toEqual([`Tile "Card" expects 1 argument(s) but got 0`]);
  });

  it("leaves an undefined target to E0105 alone", () => {
    expect(
      errorCodesOf(
        app(`test t =
    tile-test Nope
        given  = {slots: {}}
        expect = text("x")`),
      ),
    ).toEqual(["E0105"]);
  });

  it("refuses a built-in target, which the generated test cannot apply at all", () => {
    const src = app(`test t =
    tile-test text
        given  = {slots: {}}
        expect = text("x")`);
    expect(errorCodesOf(src)).toEqual(["E0105"]);
    expect(messagesOf(src, { warnings: false })).toEqual([
      `Tile-test target "text" is a built-in tile — a tile-test can only name a tile the program defines`,
    ]);
  });

  it("says nothing more about a built-in target that is also given an `in`", () => {
    expect(
      errorCodesOf(
        app(`test t =
    tile-test text
        given  = {slots: {}, in: "x"}
        expect = text("x")`),
      ),
    ).toEqual(["E0105"]);
  });

  it("names a `given` whose section nothing reads once — the E0714 is the mistake", () => {
    const src = app(`test t =
    tile-test Card
        given  = {slots: {}, input: "x"}
        expect = text("x")`);
    expect(errorCodesOf(src)).toEqual(["E0714"]);
  });

  it("reports an `in` the target does not declare whatever else the given misspells", () => {
    const src = app(`test t =
    tile-test Host
        given  = {slotz: {}, in: "x"}
        expect = column(text("x"))`);
    expect(errorCodesOf(src).sort()).toEqual(["E0213", "E0714"]);
  });

  it("leaves a given that is not a record at all to E0713", () => {
    expect(
      errorCodesOf(
        app(`test t =
    tile-test Card
        given  = 42
        expect = text("x")`),
      ),
    ).toEqual(["E0713"]);
  });

  it("reports a non-record given to a target that declares no in=, too", () => {
    expect(
      errorCodesOf(
        app(`test t =
    tile-test Host
        given  = 42
        expect = column(text("x"))`),
      ),
    ).toEqual(["E0713"]);
  });

  it("checks a reducer-test's target with none of this — it has no in= to declare", () => {
    expect(
      errorsOf(`slot count : Int = 0

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
  it("refuses a value the target's in= does not accept", () => {
    const src = app(`test t =
    tile-test Card
        given  = {slots: {}, in: 42}
        expect = text("42")`);
    expect(errorCodesOf(src)).toEqual(["E0201"]);
  });

  it("reports it at the value, which is the text to change", () => {
    const src = app(`test t =
    tile-test Card
        given  = {slots: {}, in: 42}
        expect = text("42")`);
    const d = locatedOf(src, { warnings: false })[0];
    expect(d && textAt(src, d)).toMatch(/^42/);
  });

  it("reads a record in= field by field, as a tile call's argument is read", () => {
    const src = app(
      `test t =
    tile-test Card
        given  = {slots: {}, in: {name: "Ada"}}
        expect = text("Ada")`,
      `slot count : Int = 0

tile Card in={label: Text} = text($1.label)
tile Host = column(Card({label: "x"}))`,
    );
    expect(errorCodesOf(src).sort()).toEqual(["E0214", "E0215"]);
  });

  it("accepts the value the target's in= does accept", () => {
    expect(
      errorsOf(
        app(`test t =
    tile-test Card
        given  = {slots: {}, in: "Ada"}
        expect = text("Ada")`),
      ),
    ).toEqual([]);
  });

  it("says nothing about a value a target declaring no in= was never given", () => {
    expect(
      errorsOf(
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
    const d = locatedOf(src, { warnings: false });
    expect(d.map((e) => `${e.code} ${e.message}`)).toEqual([
      "E0201 Expected {label: Text} but got Unit",
    ]);
    expect(d[0] && textAt(src, d[0])).toMatch(/^\(\)\}/);
  });

  it("leaves the count to E0213 rather than typing an argument that is not there", () => {
    expect(
      errorCodesOf(
        app(`test t =
    tile-test Card
        given  = {slots: {}}
        expect = text("x")`),
      ),
    ).toEqual(["E0213"]);
  });
});

describe("codegen refuses what check refuses", () => {
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
    // A lowering that dropped the argument would still apply `_in`, so the bound value carries the assertion.
    const js = codegen(parse(lex(ok)), {
      runtimeSpecifier: "@kumikijs/runtime",
      includeTests: true,
    }).js;
    expect(js).toContain(`const _in = "x";`);
    expect(js).toContain(`_tilesById["Card"](_in)`);
  });
});
