// A name declared twice, and what happened before it was reported.
//
// Symbol collection is `Map.set` without a `has`, so the later definition won
// and the earlier one vanished. The sharpest case is two reducers of one name:
// code generation emits both into `_reducers` and the runtime dispatches the
// first, while the checker validated only the second — so the program that
// ran was not the program that was checked.
//
// Inside a construct the parser is where it happened. `app` and `effect`
// clauses and `theme` records were assembled into a record whose later key
// overwrote the earlier one, which for `caps` means the declared capability
// set silently depended on clause order.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TAIL = `app Main caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
const APP = `tile App = column(text("x"))\n`;
const diags = (src: string) => check(parse(lex(src)));
const codes = (src: string) => diags(src).map((e) => e.code);

describe("a definition declared twice in one layer", () => {
  // One row per layer: the check is over `program.defs`, so a layer that is
  // added to the language and not to it is a layer that keeps the old
  // last-one-wins behaviour.
  const layers: [string, string][] = [
    ["type", `type T = Int\ntype T = Text`],
    ["slot", `slot a : Int = 0\nslot a : Int = 1`],
    ["fn", `fn f(n: Int) -> Int = n\nfn f(n: Int) -> Int = n + 1`],
    ["tile", `tile T = column(text("a"))\ntile T = column(text("b"))`],
    [
      "reducer",
      `slot a : Int = 0\ntile B = button(text="b", onClick=r)\nreducer r on=ui.click(B) do= a := 1\nreducer r on=ui.click(B) do= a := 2`,
    ],
    [
      "effect",
      `effect E cap=custom.thing in=Text out=Result(Unit, Text)\neffect E cap=custom.thing in=Text out=Result(Unit, Text)`,
    ],
    ["theme", `theme T = {gap: "1"}\ntheme T = {gap: "2"}`],
    [
      // `LAYER_OF_DEF` is exhaustive over the `Def` kinds, so every layer it
      // names needs a row here — the table's own purpose is that a layer
      // cannot be forgotten, and `test` was forgotten on the first pass.
      "test",
      `slot a : Int = 0
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= a := 1
test t = reducer-test r given = {slots: {a: 0}, event: {type: ui.click, target: B}} expect = {slots: {a: 1}, effects: []}
test t = reducer-test r given = {slots: {a: 9}, event: {type: ui.click, target: B}} expect = {slots: {a: 10}, effects: []}`,
    ],
    [
      "motion",
      `motion M = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}, duration: 100}
motion M = {keyframes: {from: {opacity: 1}, to: {opacity: 0}}, duration: 100}`,
    ],
  ];
  for (const [layer, defs] of layers) {
    it(`reports a duplicate ${layer}`, () => {
      expect(codes(`${defs}\n${APP}${TAIL}`)).toContain("E0007");
    });
  }

  it("reports once per occurrence past the first, at that occurrence", () => {
    const src = `slot a : Int = 0
slot a : Int = 1
slot a : Int = 2
${APP}${TAIL}`;
    const found = diags(src).filter((e) => e.code === "E0007");
    expect(found.map((e) => `${e.pos.line}:${e.pos.col}`)).toEqual(["2:1", "3:1"]);
    expect(found[0]?.message).toContain(`slot "a"`);
  });

  it("leaves the same name in two different layers alone", () => {
    // Namespaces are per layer, and `tile leaf` next to `slot leaf` is how a
    // program reaches code generation's bare-identifier child resolution.
    expect(codes(`slot leaf : Int = 1\ntile leaf = column(text("l"))\n${APP}${TAIL}`)).toEqual([]);
  });

  it("leaves a program's own definition shadowing the standard library alone", () => {
    // Seeded standard-library types live in the same table the checker reads,
    // so a uniqueness check written over that table would report this.
    expect(codes(`type Route = Text\nslot r : Route = "x"\n${APP}${TAIL}`)).toEqual([]);
  });

  it("leaves a second app to E0004", () => {
    const src = `${APP}app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(codes(src)).toEqual(["E0004"]);
  });
});

describe("a name declared twice inside one construct", () => {
  const shapes: [string, string, string][] = [
    [
      "an app clause",
      "duplicate-clause",
      `${APP}app A caps=[nav.push] caps=[] routes={"/" -> App, "/404" -> App} init=[]\n`,
    ],
    [
      "an effect clause",
      "duplicate-clause",
      `effect E cap=custom.a cap=custom.b in=Text out=Result(Unit, Text)\n${APP}${TAIL}`,
    ],
    ["a record literal key", "duplicate-key", `slot s : Int = {a: 1, a: 2}.a\n${APP}${TAIL}`],
    [
      "a map literal key",
      "duplicate-key",
      `slot s : Map(Text, Int) = {"a": 1, "a": 2}\n${APP}${TAIL}`,
    ],
    ["a theme entry", "duplicate-key", `theme T = {gap: "1", gap: "2"}\n${APP}${TAIL}`],
    [
      // The motion grammar is the theme grammar, but a separate definition
      // kind — so a duplicate here travels a second wire that must be
      // connected on its own.
      "a motion keyframe stop",
      "duplicate-key",
      `motion Fade = {keyframes: {from: {opacity: 0}, from: {opacity: 1}, to: {opacity: 1}}, duration: 100}\n${APP}${TAIL}`,
    ],
    [
      "a nested theme entry",
      "duplicate-key",
      `theme T = {space: {sm: "1", sm: "2"}}\n${APP}${TAIL}`,
    ],
    [
      "a route pattern",
      "duplicate-key",
      `tile Other = column(text("o"))\n${APP}app A caps=[] routes={"/" -> App, "/" -> Other, "/404" -> App} init=[]\n`,
    ],
    ["a record type field", "duplicate-field", `type R = {a: Int, a: Text}\n${APP}${TAIL}`],
    [
      "an inline record type field",
      "duplicate-field",
      `slot s : {a: Int, a: Text} = {a: 1}\n${APP}${TAIL}`,
    ],
    ["a fn parameter", "duplicate-param", `fn f(a: Int, a: Int) -> Int = a\n${APP}${TAIL}`],
    ["a type parameter", "duplicate-param", `type Box(T, T) = {v: T}\n${APP}${TAIL}`],
    ["a union variant", "duplicate-variant", `type U = A | B | A\n${APP}${TAIL}`],
    // The four constructs no existing check walked. Each is reached only by
    // the structural descent, so each is a row of its own.
    [
      "a tile clause",
      "duplicate-clause",
      `type A = Int\ntype B = Int\ntile Row in=A in=B = text("hi")\n${APP}${TAIL}`,
    ],
    [
      "a named tile argument",
      "duplicate-key",
      `slot a : Text = "x"\nslot b : Text = "y"\ntile I = input(bind=a, bind=b)\n${APP}${TAIL}`,
    ],
    ["a tile prop", "duplicate-key", `tile I = box() {gap: "sm", gap: "lg"}\n${APP}${TAIL}`],
    [
      "an app config record",
      "duplicate-key",
      `${APP}app A caps=[] routes={"/" -> App, "/404" -> App} init=[] meta={title: "one", title: "two"}\n`,
    ],
    [
      "a reducer-test given",
      "duplicate-key",
      `slot a : Int = 0
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= a := 1
test t = reducer-test r
    given  = {slots: {a: 0}, slots: {a: 5}, event: {type: ui.click, target: B}}
    expect = {slots: {a: 1}, effects: []}
${APP}${TAIL}`,
    ],
    [
      "a property-test generator",
      "duplicate-param",
      `slot a : Int = 0
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= a := 1
test p = property-test
    for-all   = {n: Int, n: Text}
    given     = {slots: {a: 0}, event: {type: ui.click, target: B}}
    invariant = run-reducer(r).slots.a == 1
${APP}${TAIL}`,
    ],
    [
      "a slot initializer's record",
      "duplicate-key",
      `slot s : Int = {a: 1, a: 2}.a\n${APP}${TAIL}`,
    ],
    [
      "a reducer body's record",
      "duplicate-key",
      `slot a : Int = 0
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= a := {x: 1, x: 2}.x
${APP}${TAIL}`,
    ],
  ];
  for (const [what, kind, src] of shapes) {
    it(`reports ${what}`, () => {
      const found = diags(src).filter((e) => e.code === "E0008");
      expect(found.length, `no E0008 for ${what}`).toBeGreaterThan(0);
      expect(found[0]?.kind).toBe(kind);
    });
  }

  // The message has to say what kind of thing was duplicated: `kind` is
  // machine-readable and the position is a point, so the sentence is the only
  // part that tells a reader which of several names on one line to delete.
  const messages: [string, string, string][] = [
    ["a record type field", "Record type field", "type R = {a: Int, a: Text}"],
    ["a union variant", "Union variant", "type U = A | B | A"],
    [
      "a fn parameter",
      'Parameter "a" is written more than once in fn "f"',
      "fn f(a: Int, a: Int) -> Int = a",
    ],
    [
      "a type parameter",
      'Parameter "T" is written more than once in type "Box"',
      "type Box(T, T) = {v: T}",
    ],
    ["a record literal key", "Record field", "slot s : Int = {a: 1, a: 2}.a"],
    ["a map literal key", 'Map key "a"', 'slot s : Map(Text, Int) = {"a": 1, "a": 2}'],
    // The kind tag that makes `{"1": …, 1: …}` two keys is a comparison
    // detail; the message names the key the way it was written.
    ["a negative map key", 'Map key "-1"', "slot s : Map(Int, Int) = {-1: 1, -1: 2}"],
    ["a theme entry", "theme key", 'theme T = {gap: "1", gap: "2"}'],
    [
      "a motion keyframe stop",
      "motion key",
      "motion Fade = {keyframes: {from: {opacity: 0}, from: {opacity: 1}, to: {opacity: 1}}, duration: 100}",
    ],
    [
      "an app clause",
      "app clause",
      `${APP}app A caps=[] caps=[] routes={"/" -> App, "/404" -> App} init=[]`,
    ],
    [
      "an effect clause",
      "effect clause",
      "effect E cap=custom.a cap=custom.b in=Text out=Result(Unit, Text)",
    ],
    [
      "a route pattern",
      "Route pattern",
      `${APP}app A caps=[] routes={"/" -> App, "/" -> App, "/404" -> App} init=[]`,
    ],
  ];
  for (const [what, says, defs] of messages) {
    it(`names what was duplicated for ${what}`, () => {
      const err = diags(`${defs}\n${APP}${TAIL}`).find((e) => e.code === "E0008");
      expect(err, `no E0008 for ${what}`).toBeDefined();
      expect(err?.message).toContain(says);
    });
  }

  it("points at the later occurrence, which is the one to delete", () => {
    const err = diags(`type R = {a: Int, a: Text}\n${APP}${TAIL}`)[0];
    expect(err?.code).toBe("E0008");
    expect(err?.message).toContain(`"a"`);
    expect(`${err?.pos.line}:${err?.pos.col}`).toBe("1:19");
  });

  it("reports once per occurrence past the first, like E0007 does", () => {
    // The policy `uniqueness.ts` states, on the E0008 side: three writes are
    // two edits, so two findings.
    const found = diags(`type R = {a: Int, a: Text, a: Bool}\n${APP}${TAIL}`).filter(
      (e) => e.code === "E0008",
    );
    expect(found.map((e) => `${e.pos.line}:${e.pos.col}`)).toEqual(["1:19", "1:28"]);
  });

  // The parser-recorded path (`duplicateClauses` / `duplicateKeys`) carries
  // its own positions, and nothing else asserts them — a broken hand-off
  // would still produce a diagnostic, just one pointing at the wrong token.
  const recorded: [string, string, string][] = [
    [
      "an app clause",
      `${APP}app A caps=[] caps=[] routes={"/" -> App, "/404" -> App} init=[]`,
      "2:15",
    ],
    [
      "an effect clause",
      `effect E cap=custom.a cap=custom.b in=Text out=Result(Unit, Text)\n${APP}${TAIL}`,
      "1:23",
    ],
    ["a tile clause", `type A = Int\ntile Row in=A in=A = text("x")\n${APP}${TAIL}`, "2:15"],
    ["a theme key", `theme T = {gap: "1", gap: "2"}\n${APP}${TAIL}`, "1:22"],
    [
      "a motion key",
      `motion Fade = {keyframes: {from: {opacity: 0}, from: {opacity: 1}, to: {opacity: 1}}, duration: 100}\n${APP}${TAIL}`,
      "1:48",
    ],
  ];
  for (const [what, src, at] of recorded) {
    it(`points at the later occurrence of ${what}`, () => {
      const err = diags(src).find((e) => e.code === "E0008");
      expect(err, `no E0008 for ${what}`).toBeDefined();
      expect(`${err?.pos.line}:${err?.pos.col}`).toBe(at);
    });
  }

  it("compares map keys by kind, not by their text", () => {
    // `{"1": …, 1: …}` is two keys. Normalising both to `"1"` reported a
    // duplicate that is not one.
    expect(codes(`slot s : Map(Text, Int) = {"1": 1, 1: 2}\n${APP}${TAIL}`)).not.toContain("E0008");
    // And a negated literal is still a literal: `-1` parses as a unary minus
    // over a number, which a `kind === "Num"` filter does not match.
    expect(codes(`slot s : Map(Int, Int) = {-1: 1, -1: 2}\n${APP}${TAIL}`)).toContain("E0008");
  });

  it("says nothing about two computed keys", () => {
    // Whether they collide is the runtime's question — a documented decision,
    // so it needs a test that fails if the filter is dropped. A *bare* name
    // parses as a record shorthand, so the key has to be a real expression
    // for this to be the map path at all.
    const src = `slot k : Text = "a"
slot m : Map(Text, Int) = {k.trim(): 1, k.trim(): 2}
${APP}${TAIL}`;
    expect(codes(src)).not.toContain("E0008");
  });

  it("does not lose a __proto__ key to the object it is accumulated in", () => {
    // Theme keys are gathered into a plain object, where `__proto__` replaces
    // the prototype instead of adding a property — so the key disappeared and
    // could never be seen twice.
    expect(codes(`theme T = {c: {__proto__: "a", __proto__: "b"}}\n${APP}${TAIL}`)).toContain(
      "E0008",
    );
  });

  it("leaves a repeated sub-route path to E0112, which came first", () => {
    // One mistake, one diagnostic. `E0112` reads the same rule now, so it
    // points at the offending entry rather than at the tile that holds it.
    const src = `tile NotFound = page(heading("404"))
tile A = page(heading("a"))
tile L sub-routes = { "/x" -> A, "/x" -> A } = page(route-outlet())
app M caps=[] routes={"/*" -> L, "/404" -> NotFound} init=[]
`;
    const found = diags(src);
    expect(found.map((e) => e.code)).toEqual(["E0112"]);
    expect(`${found[0]?.pos.line}:${found[0]?.pos.col}`).toBe("3:34");
  });

  it("leaves distinct names in the same construct alone", () => {
    const src = `type R = {a: Int, b: Text}
type U = A | B
fn f(a: Int, b: Int) -> Int = a + b
theme T = {gap: "1", pad: "2"}
slot s : R = {a: 1, b: "x"}
${APP}app A caps=[nav.push] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(codes(src)).toEqual([]);
  });

  it("leaves one key per record in sibling records alone", () => {
    // Sibling scopes, not one scope: an accumulator that forgets to reset
    // would read these as a duplicate.
    expect(codes(`theme T = {space: {sm: "1"}, size: {sm: "2"}}\n${APP}${TAIL}`)).toEqual([]);
  });
});
