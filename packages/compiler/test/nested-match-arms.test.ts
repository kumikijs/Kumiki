import { lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import {
  builtSummariesOf,
  checkSource,
  nonExhaustiveMessage,
  pointedDiagnosticsOf,
  posOf,
} from "./helpers/diagnostics.ts";
import { withButtonApp, withReducer } from "./helpers/programs.ts";

const DEFS = `type Color = Red | Green | Blue
type Size = Small | Large
slot n  : Int        = 0
slot m  : Int        = 0
slot c  : Color      = Green
slot s  : Size       = Small
slot b  : Bool       = true
slot xs : List(Size) = [Small]`;

const program = (defs: string) => withButtonApp(`${DEFS}\n${defs}`);
const fnOf = (body: string) =>
  program(`fn f(x: Color, y: Size, z: Size, o: Option(Int)) -> Int = ${body}`);
const reducerOf = (body: string) => withReducer(DEFS, body);
const tileOf = (body: string) => program(`tile T = ${body}`);

const CLOSE_OFF = {
  value: "put the inner match in parentheses: `(match … with …)`",
  statement:
    "put the arm's statements in braces, ending with the inner match: `-> { … match … with … }`",
  tile: "move the inner match into a tile of its own and name that tile in the arm",
};

type Form = keyof typeof CLOSE_OFF;

const at = (src: string, needle: string) => {
  const { line, col } = posOf(src, needle);
  return `${line}:${col}`;
};

/** W0219 for the arm `arm`, where `inner` and `outer` are the text each `match` starts with. */
const unreachable = (src: string, form: Form, arm: string, inner: string, outer: string) => ({
  code: "W0219",
  message:
    `The arm \`${arm}\` can never be reached: it belongs to the match at ${at(src, inner)}, ` +
    "whose arms above it already match every value. That match ends an arm of the match at " +
    `${at(src, outer)}, so it takes every arm written after it. To give this arm to the match ` +
    `at ${at(src, outer)}, ${CLOSE_OFF[form]}`,
});

/** E0227 for a match whose last arm ends in a match that nothing closes off. */
const missingPast = (type: string, values: string) =>
  `${nonExhaustiveMessage(type, values)}. The match that ends this match's last arm takes every ` +
  "arm written after it: put it in parentheses, `(match … with …)`, for an arm after it to be " +
  "this match's";

/** E0227 for `match x`, the outer match of every `fnOf` body below whose `Red` arm is its last. */
const xMissing = { code: "E0227", message: missingPast("Color", "Green, Blue") };

const codesAndMessages = (src: string) =>
  pointedDiagnosticsOf(src).map(({ code, message }) => ({ code, message }));

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
    ["`_`", "match y with | Small -> 1 | Large -> 2 | _ -> 3", "_", "match y"],
    ["a binding name", "match y with | Small -> 1 | Large -> 2 | other -> 3", "other", "match y"],
    [
      "a tuple",
      "match (y, z) with | (Small, _) -> 1 | (Large, _) -> 2 | (_, Small) -> 3",
      "(_, Small)",
      "match (y, z)",
    ],
    [
      "a variant that binds its payload",
      "match o with | None -> 1 | Some(v) -> 2 | Some(w) -> 3",
      "Some(w)",
      "match o",
    ],
  ])("warns at %s that a value match takes after its arms cover every value", (_, inner, arm, head) => {
    const src = fnOf(`match x with | Red -> ${inner}`);
    expect(pointedDiagnosticsOf(src)).toEqual([
      { ...unreachable(src, "value", arm, head, "match x"), text: `${arm} -> 3` },
      { ...xMissing, text: expect.stringMatching(/^match x/) },
    ]);
  });

  it("warns at the arm of a statement match laid out for the outer one", () => {
    const src = reducerOf(`match c with
        | Red -> match s with
            | Small -> n := 1
            | Large -> n := 2
        | _ -> n := 3`);
    expect(pointedDiagnosticsOf(src)).toEqual([
      { ...unreachable(src, "statement", "_", "match s", "match c"), text: "_ -> n := 3" },
    ]);
  });

  it("warns at the arm of a tile match laid out for the outer one", () => {
    const src = tileOf(
      `match c with | Red -> match s with | Small -> text("1") | Large -> text("2") | _ -> text("3")`,
    );
    expect(pointedDiagnosticsOf(src)).toEqual([
      { ...unreachable(src, "tile", "_", "match s", "match c"), text: '_ -> text("3")' },
    ]);
  });

  // Only a value match is held to cover its scrutinee, so only `match x` adds E0227.
  it.each([
    [
      "an operator's right operand",
      fnOf("match x with | Red -> 1 + match y with | Small -> 1 | Large -> 2 | _ -> 3"),
      (src: string) => [unreachable(src, "value", "_", "match y", "match x"), xMissing],
    ],
    [
      "a prefix `-`",
      fnOf("match x with | Red -> -match y with | Small -> 1 | Large -> 2 | _ -> 3"),
      (src: string) => [unreachable(src, "value", "_", "match y", "match x"), xMissing],
    ],
    [
      "an `else` branch",
      fnOf(
        "match x with | Red -> if true then 0 else match y with | Small -> 1 | Large -> 2 | _ -> 3",
      ),
      (src: string) => [unreachable(src, "value", "_", "match y", "match x"), xMissing],
    ],
    [
      "a `let … in` body",
      fnOf("match x with | Red -> let w = y in match w with | Small -> 1 | Large -> 2 | _ -> 3"),
      (src: string) => [unreachable(src, "value", "_", "match w", "match x"), xMissing],
    ],
    [
      "a slot write's right-hand side",
      reducerOf("match c with | Red -> n := match s with | Small -> 1 | Large -> 2 | _ -> 3"),
      (src: string) => [unreachable(src, "value", "_", "match s", "match c")],
    ],
    [
      "a `let` statement's right-hand side",
      reducerOf("match c with | Red -> let v = match s with | Small -> 1 | Large -> 2 | _ -> 3"),
      (src: string) => [unreachable(src, "value", "_", "match s", "match c")],
    ],
    [
      "an `if` statement's `else`",
      reducerOf(
        "match c with | Red -> if b then n := 0 else match s with | Small -> n := 1 | Large -> n := 2 | _ -> n := 3",
      ),
      (src: string) => [unreachable(src, "statement", "_", "match s", "match c")],
    ],
    [
      "the `then` of an `if` statement without `else`",
      reducerOf(
        "match c with | Red -> if b then match s with | Small -> n := 1 | Large -> n := 2 | _ -> n := 3",
      ),
      (src: string) => [unreachable(src, "statement", "_", "match s", "match c")],
    ],
    [
      "a `for` statement's body",
      reducerOf(
        "match c with | Red -> for x in xs match x with | Small -> n := 1 | Large -> n := 2 | _ -> n := 3",
      ),
      (src: string) => [unreachable(src, "statement", "_", "match x", "match c")],
    ],
    [
      "the last statement of an arm, after another",
      reducerOf(`match c with
        | Red -> m := 0
          match s with
          | Small -> n := 1
          | Large -> n := 2
        | _ -> n := 3`),
      (src: string) => [unreachable(src, "statement", "_", "match s", "match c")],
    ],
    [
      "a tile `if`'s `else`",
      tileOf(
        'match c with | Red -> if b then text("0") else match s with | Small -> text("1") | Large -> text("2") | _ -> text("3")',
      ),
      (src: string) => [unreachable(src, "tile", "_", "match s", "match c")],
    ],
    [
      "a tile `for`'s body",
      tileOf(
        'match c with | Red -> for x in xs match x with | Small -> text("1") | Large -> text("2") | _ -> text("3")',
      ),
      (src: string) => [unreachable(src, "tile", "_", "match x", "match c")],
    ],
  ])("warns where a match ends the arm as %s", (_, src, expected) => {
    expect(codesAndMessages(src)).toEqual(expected(src));
  });

  it("warns at the first arm the inner match can never reach, not at those after it", () => {
    const src = fnOf(
      "match x with | Red -> match y with | Small -> 1 | Large -> 2 | _ -> 3 | other -> 4",
    );
    expect(pointedDiagnosticsOf(src)).toEqual([
      { ...unreachable(src, "value", "_", "match y", "match x"), text: "_ -> 3 | other -> 4" },
      { ...xMissing, text: expect.stringMatching(/^match x/) },
    ]);
  });

  it("warns once for each inner match that takes an arm it can never reach", () => {
    const src = fnOf(
      "match x with | Red -> match y with | Small -> 1 | Large -> 2 | _ -> match z with | Small -> 1 | Large -> 2 | _ -> 3",
    );
    expect(codesAndMessages(src)).toEqual([
      unreachable(src, "value", "_", "match z", "match y"),
      unreachable(src, "value", "_", "match y", "match x"),
      xMissing,
    ]);
  });

  // A pattern that does not fit the scrutinee is E0209, which already says what is wrong. `match x`
  // is a value match with no arm for `Green` or `Blue`, so it adds E0227.
  it.each([
    [
      "value",
      fnOf("match x with | Red -> match y with | Small -> 1 | Large -> 2 | Green -> 3 | _ -> 4"),
      ["E0209", "E0227"],
    ],
    [
      "statement",
      reducerOf(
        "match c with | Red -> match s with | Small -> n := 1 | Large -> n := 2 | Green -> n := 3",
      ),
      ["E0209"],
    ],
    [
      "tile",
      tileOf(
        'match c with | Red -> match s with | Small -> text("1") | Large -> text("2") | Green -> text("3")',
      ),
      ["E0209"],
    ],
  ])("leaves a %s match whose arm does not fit its scrutinee to E0209", (_, src, codes) => {
    expect(checkSource(src).map((d) => d.code)).toEqual(codes);
  });

  it("does not take an arm as covered when that hinges on an undecidable type", () => {
    const src = program(
      "fn f(x: Color, cs: List(Color)) -> Int = match x with | Red -> match cs.fold(x, $2) with | Red -> 1 | Green -> 2 | Blue -> 3 | _ -> 4 | _ -> 5",
    );
    expect(pointedDiagnosticsOf(src)).toEqual([
      {
        ...unreachable(src, "value", "_", "match cs", "match x"),
        text: "_ -> 5",
      },
      { ...xMissing, text: expect.stringMatching(/^match x/) },
    ]);
  });

  // A statement or tile match may leave values out (language.md), so the program runs as parsed.
  it.each([
    [
      "statement",
      reducerOf(
        "match c with | Red -> match s with | Small -> n := 1 | Large -> n := 2 | _ -> n := 3",
      ),
    ],
    [
      "tile",
      tileOf(
        'match c with | Red -> match s with | Small -> text("1") | Large -> text("2") | _ -> text("3")',
      ),
    ],
  ])("is a warning, so a %s match that takes the arm still builds", (_, src) => {
    expect(checkSource(src).map((d) => [d.code, d.severity])).toEqual([["W0219", "warning"]]);
    expect(builtSummariesOf(src)).toEqual([]);
  });

  it("names the match the arm belongs to and the one it ends, a level at a time", () => {
    const src = fnOf(
      "match x with | Red -> match y with | Small -> match z with | Small -> 1 | Large -> 2 | _ -> 3",
    );
    expect(pointedDiagnosticsOf(src)).toEqual([
      { ...unreachable(src, "value", "_", "match z", "match y"), text: "_ -> 3" },
      {
        code: "E0227",
        message: missingPast("Size", "Large"),
        text: expect.stringMatching(/^match y/),
      },
      { ...xMissing, text: expect.stringMatching(/^match x/) },
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
      "statement after another, all in braces",
      reducerOf(`match c with
        | Red -> { m := 0
            match s with
            | Small -> n := 1
            | Large -> n := 2 }
        | _ -> n := 3`),
    ],
    [
      "tile",
      program(`tile BySize = match s with | Small -> text("1") | Large -> text("2")
tile T = match c with | Red -> BySize | _ -> text("3")`),
    ],
  ])("checks clean as a %s closed off before the next arm", (_, src) => {
    expect(pointedDiagnosticsOf(src)).toEqual([]);
  });

  it("checks clean when every arm the nested match takes can be reached", () => {
    expect(
      pointedDiagnosticsOf(
        fnOf("match x with | Red -> 0 | _ -> match y with | Small -> 1 | Large -> 2"),
      ),
    ).toEqual([]);
  });

  it("leaves a covered arm inside a match closed off in parentheses", () => {
    expect(
      pointedDiagnosticsOf(
        fnOf("match x with | Red -> (match y with | Small -> 1 | Large -> 2 | _ -> 3) | _ -> 4"),
      ),
    ).toEqual([]);
  });

  it("leaves a covered arm of a match that ends no other match's arm", () => {
    expect(pointedDiagnosticsOf(fnOf("match x with | Red -> 1 | _ -> 2 | Green -> 3"))).toEqual([]);
  });
});

describe("E0227 on a match whose last arm ends in a nested match", () => {
  it("says the arms after the nested match are its own", () => {
    const src = fnOf("match x with | Red -> match y with | Small -> 1 | other -> 3");
    expect(pointedDiagnosticsOf(src)).toEqual([
      { ...xMissing, text: expect.stringMatching(/^match x/) },
    ]);
  });

  it("keeps its message when the nested match is in parentheses", () => {
    const src = fnOf("match x with | Red -> (match y with | Small -> 1 | Large -> 2)");
    expect(pointedDiagnosticsOf(src)).toEqual([
      {
        code: "E0227",
        message: nonExhaustiveMessage("Color", "Green, Blue"),
        text: expect.stringMatching(/^match x/),
      },
    ]);
  });
});
