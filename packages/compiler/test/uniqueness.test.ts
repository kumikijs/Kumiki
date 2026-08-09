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
    ["a map literal key", "Map key", 'slot s : Map(Text, Int) = {"a": 1, "a": 2}'],
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
