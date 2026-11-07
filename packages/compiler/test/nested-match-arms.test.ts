import { lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { pointedErrorsOf, posOf } from "./helpers/diagnostics.ts";
import { withButtonApp } from "./helpers/programs.ts";

const DEFS = `type Color = Red | Green | Blue
type Size = Small | Large
slot n : Int   = 0
slot c : Color = Green
slot s : Size  = Small
slot b : Bool  = true`;

const program = (defs: string) => withButtonApp(`${DEFS}\n${defs}`);
const fnOf = (body: string) => program(`fn f(x: Color, y: Size, z: Size) -> Int = ${body}`);
const reducerOf = (body: string) => program(`reducer r on=ui.click(B)\n    do= ${body}`);
const tileOf = (body: string) => program(`tile T = ${body}`);

const CLOSE_OFF = {
  value: "put the inner match in parentheses: `(match … with …)`",
  statement: "put the inner match in braces: `{ match … with … }`",
  tile: "move the inner match into a tile of its own and name that tile in the arm",
};

type Form = keyof typeof CLOSE_OFF;

const at = (src: string, needle: string) => {
  const { line, col } = posOf(src, needle);
  return `${line}:${col}`;
};

/** E0239 for the arm `arm`, where `inner` and `outer` are the text each `match` starts with. */
const unreachable = (src: string, form: Form, arm: string, inner: string, outer: string) => ({
  code: "E0239",
  message:
    `The arm \`${arm}\` can never be reached: it belongs to the match at ${at(src, inner)}, ` +
    "whose arms above it already match every value. That match ends an arm of the match at " +
    `${at(src, outer)}, so it takes every arm written after it. To give this arm to the match ` +
    `at ${at(src, outer)}, ${CLOSE_OFF[form]}`,
});

const missing = (type: string, values: string) =>
  `This match on "${type}" has no arm for ${values}, and a match used as a value has to evaluate ` +
  "to one of its arms. Add the missing arms, or end with `_ -> …`";

/** E0227 for a match whose last arm ends in the match that starts with `inner`. */
const missingPast = (src: string, type: string, values: string, inner: string) =>
  `${missing(type, values)}. The match at ${at(src, inner)} ends this match's last arm, so it ` +
  "takes every arm written after it: put it in parentheses, `(match … with …)`, for an arm " +
  "after it to be this match's";

describe("a match that ends an arm takes the arms written after it", () => {
  it("reads every arm after the nested match as that match's", () => {
    const src = fnOf("match x with | Red -> match y with | Small -> 1 | Large -> 2 | _ -> 3");
    expect(parse(lex(src)).defs.find((d) => d.kind === "FnDef")).toMatchObject({
      body: {
        kind: "MatchExpr",
        arms: [
          {
            pattern: { name: "Red" },
            body: { kind: "MatchExpr", arms: [{}, {}, { pattern: { kind: "PWildcard" } }] },
          },
        ],
      },
    });
  });

  it.each([
    ["`_`", "_", "| _ -> 3"],
    ["a binding name", "other", "| other -> 3"],
  ])("reports %s that a value match takes after its arms cover every value", (_, arm, written) => {
    const src = fnOf(`match x with | Red -> match y with | Small -> 1 | Large -> 2 ${written}`);
    expect(pointedErrorsOf(src)).toEqual([
      { ...unreachable(src, "value", arm, "match y", "match x"), text: `${arm} -> 3` },
      {
        code: "E0227",
        message: missingPast(src, "Color", "Green, Blue", "match y"),
        text: expect.stringMatching(/^match x/),
      },
    ]);
  });

  it("reports the arm of a statement match laid out for the outer one", () => {
    const src = reducerOf(`match c with
        | Red -> match s with
            | Small -> n := 1
            | Large -> n := 2
        | _ -> n := 3`);
    expect(pointedErrorsOf(src)).toEqual([
      { ...unreachable(src, "statement", "_", "match s", "match c"), text: "_ -> n := 3" },
    ]);
  });

  it("reports the arm of a tile match laid out for the outer one", () => {
    const src = tileOf(
      `match c with | Red -> match s with | Small -> text("1") | Large -> text("2") | _ -> text("3")`,
    );
    expect(pointedErrorsOf(src)).toEqual([
      { ...unreachable(src, "tile", "_", "match s", "match c"), text: '_ -> text("3")' },
    ]);
  });

  it.each([
    [
      "an operator's right operand",
      "value",
      fnOf("match x with | Red -> 1 + match y with | Small -> 1 | Large -> 2 | _ -> 3"),
      "match y",
    ],
    [
      "an `else` branch",
      "value",
      fnOf(
        "match x with | Red -> if true then 0 else match y with | Small -> 1 | Large -> 2 | _ -> 3",
      ),
      "match y",
    ],
    [
      "a `let … in` body",
      "value",
      fnOf("match x with | Red -> let w = y in match w with | Small -> 1 | Large -> 2 | _ -> 3"),
      "match w",
    ],
    [
      "an `if` statement's `else`",
      "statement",
      reducerOf(
        "match c with | Red -> if b then n := 0 else match s with | Small -> n := 1 | Large -> n := 2 | _ -> n := 3",
      ),
      "match s",
    ],
    [
      "a tile `if`'s `else`",
      "tile",
      tileOf(
        'match c with | Red -> if b then text("0") else match s with | Small -> text("1") | Large -> text("2") | _ -> text("3")',
      ),
      "match s",
    ],
  ] as const)("reports a match that ends the arm as %s", (_, form, src, inner) => {
    const outer = form === "value" ? "match x" : "match c";
    // Only a value match is held to cover its scrutinee.
    const uncovered =
      form === "value"
        ? [{ code: "E0227", message: missingPast(src, "Color", "Green, Blue", inner) }]
        : [];
    expect(pointedErrorsOf(src).map(({ code, message }) => ({ code, message }))).toEqual([
      unreachable(src, form, "_", inner, outer),
      ...uncovered,
    ]);
  });

  it("names the match the arm belongs to and the one it ends, a level at a time", () => {
    const src = fnOf(
      "match x with | Red -> match y with | Small -> match z with | Small -> 1 | Large -> 2 | _ -> 3",
    );
    expect(pointedErrorsOf(src).filter((e) => e.code === "E0239")).toEqual([
      { ...unreachable(src, "value", "_", "match z", "match y"), text: "_ -> 3" },
    ]);
  });
});

describe("a nested match that leaves the arms after it to the outer one", () => {
  it.each([
    ["value", fnOf("match x with | Red -> (match y with | Small -> 1 | Large -> 2) | _ -> 3")],
    [
      "statement",
      reducerOf(
        "match c with | Red -> { match s with | Small -> n := 1 | Large -> n := 2 } | _ -> n := 3",
      ),
    ],
    [
      "tile",
      program(`tile BySize = match s with | Small -> text("1") | Large -> text("2")
tile T = match c with | Red -> BySize | _ -> text("3")`),
    ],
  ])("checks clean as a %s closed off before the next arm", (_, src) => {
    expect(pointedErrorsOf(src)).toEqual([]);
  });

  it("checks clean when every arm the nested match takes can be reached", () => {
    expect(
      pointedErrorsOf(
        fnOf("match x with | Red -> 0 | _ -> match y with | Small -> 1 | Large -> 2"),
      ),
    ).toEqual([]);
  });

  it("leaves a covered arm inside a match closed off in parentheses", () => {
    expect(
      pointedErrorsOf(
        fnOf("match x with | Red -> (match y with | Small -> 1 | Large -> 2 | _ -> 3) | _ -> 4"),
      ),
    ).toEqual([]);
  });

  it("leaves a covered arm of a match that ends no other match's arm", () => {
    expect(pointedErrorsOf(fnOf("match x with | Red -> 1 | _ -> 2 | Green -> 3"))).toEqual([]);
  });
});

describe("E0227 on a match whose last arm ends in a nested match", () => {
  it("says the arms after the nested match are its own", () => {
    const src = fnOf("match x with | Red -> match y with | Small -> 1 | other -> 3");
    expect(pointedErrorsOf(src)).toEqual([
      {
        code: "E0227",
        message: missingPast(src, "Color", "Green, Blue", "match y"),
        text: expect.stringMatching(/^match x/),
      },
    ]);
  });

  it("keeps its message when the nested match is in parentheses", () => {
    const src = fnOf("match x with | Red -> (match y with | Small -> 1 | Large -> 2)");
    expect(pointedErrorsOf(src)).toEqual([
      {
        code: "E0227",
        message: missing("Color", "Green, Blue"),
        text: expect.stringMatching(/^match x/),
      },
    ]);
  });
});
