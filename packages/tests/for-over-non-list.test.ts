// language.md §1.7.2 inv. 5: a `for` iterates a List. A target whose type is
// decided and is not one — an `Option(List(T))` not yet unwrapped, a `Text`,
// an `Int`, a `Result`, a record — is E0218 on both verbs, in both forms of
// the loop. Run, such a loop throws where it is used: `object is not iterable`
// in a reducer, `.map is not a function` in a tile.
//
// The checker's table, type by type, is pinned in
// `packages/compiler/test/for-over-non-list.test.ts`; the unwrapped spelling
// runs in `features/223-for-over-non-list` and its scenario.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const APP = `app A
  caps = []
  routes = {"/" -> App, "/404" -> App}
  init = []
`;

const REDUCER_FORM = `slot loaded : Option(List(Text)) = Some(["a", "b"])
slot count  : Int                = 0

reducer tally on=ui.click(Tally)
    do= for x in loaded { count := count + 1 }

tile Tally = button(text="tally") {id: "tally"}
tile App = column(Tally, text("count: " + count.show))

${APP}`;

const TILE_FORM = `slot loaded : Option(List(Text)) = Some(["a", "b"])
tile App = column(for x in loaded text(x))
${APP}`;

const OPTION_MESSAGE =
  '"for" iterates a List, but this is Option(List(Text)) — iterate its .get-or([]), or match on Some / None';

function checkAndBuild(src: string): { checked: string[]; built: string[] } {
  const checked = check(parse(lex(src))).map((e) => `${e.code} ${e.message}`);
  const r = compile(src, { runtimeSpecifier: "./runtime.js" });
  const built = r.kind === "fail" ? r.errors.map((e) => `${e.code} ${e.message}`) : [];
  return { checked, built };
}

describe("a for over an Option(List(T)) it has not unwrapped", () => {
  it.each([
    ["reducer", REDUCER_FORM],
    ["tile", TILE_FORM],
  ])("%s form: check reports it and build refuses it", (_form, src) => {
    const { checked, built } = checkAndBuild(src);
    expect(checked).toEqual([`E0218 ${OPTION_MESSAGE}`]);
    expect(built).toEqual([`E0218 ${OPTION_MESSAGE}`]);
  });

  it.each([
    ["reducer", REDUCER_FORM],
    ["tile", TILE_FORM],
  ])("%s form: the unwrapped target checks and builds", (_form, src) => {
    const { checked, built } = checkAndBuild(src.replace("in loaded", "in loaded.get-or([])"));
    expect(checked).toEqual([]);
    expect(built).toEqual([]);
  });
});

describe("every decided non-List target in one program is reported, not only the Map", () => {
  const DECLS = `slot t   : Text                    = "abc"
slot r   : Result(List(Int), Text) = Ok([1])
slot i   : Int                     = 3
slot m   : Map(Text, Int)          = {}
slot rec : {a: Int}                = {a: 1}
`;
  const TARGETS = ["t", "r", "i", "m", "rec"];

  it("reducer form", () => {
    const reducers = TARGETS.map(
      (x, k) => `reducer r${k} on=ui.click(B) do= for v in ${x} { n := n + 1 }`,
    ).join("\n");
    const src = `${DECLS}slot n : Int = 0
${reducers}
tile B = button(text="b") {id: "b"}
tile App = column(B)
${APP}`;
    const lines = src.split("\n");
    const { checked, built } = checkAndBuild(src);
    expect(checked.map((c) => c.slice(0, 5))).toEqual(TARGETS.map(() => "E0218"));
    expect(built).toEqual(checked);
    const reported = check(parse(lex(src))).map((e) => lines[e.pos.line - 1]);
    expect(reported).toEqual(TARGETS.map((x) => expect.stringContaining(`for v in ${x} `)));
  });

  it("tile form", () => {
    const loops = TARGETS.map((x) => `for v in ${x} text("${x}")`).join(",\n  ");
    const src = `${DECLS}tile App = column(
  ${loops})
${APP}`;
    const lines = src.split("\n");
    const { checked, built } = checkAndBuild(src);
    expect(checked.map((c) => c.slice(0, 5))).toEqual(TARGETS.map(() => "E0218"));
    expect(built).toEqual(checked);
    const reported = check(parse(lex(src))).map((e) => lines[e.pos.line - 1]);
    expect(reported).toEqual(TARGETS.map((x) => expect.stringContaining(`for v in ${x} `)));
  });
});
