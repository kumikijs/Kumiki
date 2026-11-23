// A whole number a definition takes outside any expression is an `int` too (language.md), so a
// literal written with a point is refused there as `0.5` is, whatever number it is read as:
// `0.99999999999999999` is read as 1.

import { lex, ParseError, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { type Pointed, pointedErrorsOf, textAt } from "./helpers/diagnostics.ts";
import { withApp, withButtonApp } from "./helpers/programs.ts";
import { withTest } from "./helpers/test-layer.ts";

/** What `src` is refused with: its parse error, or else each error `check` reports. */
function refusalsOf(src: string): Pointed[] {
  try {
    parse(lex(src));
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    const message = e.message.slice(`Parse error at ${e.pos.line}:${e.pos.col}: `.length);
    return [{ code: "parse", message, text: textAt(src, e.pos) }];
  }
  return pointedErrorsOf(src);
}

const retry = (policy: string): string =>
  withButtonApp(`effect e cap=http.get in=Unit out=Result(Text, Text) retry=${policy}`, {
    caps: "http.get",
  });

const propertyTest = (count: string): string =>
  withTest(`    property-test
        for-all   = {n: Int}
        given     = {slots: {count: n}, event: {type: ui.click, target: B}}
        invariant = run-reducer(inc).slots.count == n + 1
        count     = ${count}`);

const motion = (timing: string): string =>
  withApp(`motion Fade = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}, ${timing}}
tile App = box(text("hi")) {motion: "Fade"}`);

const MOTION_AT = "motion Fade = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}, ";

const length = (pred: string, n: string): string =>
  withButtonApp(`slot s : Text where ${pred}(${n}) = "ab"`);

type Site = {
  /** The program with `n` written where the whole number goes. */
  readonly src: (n: string) => string;
  /** What the site refuses `n` with, `0.5` included. */
  readonly refusal: (n: string) => Pointed;
};

const SITES: Record<string, Site> = {
  "a linear retry count": {
    src: (n) => retry(`linear(${n}, 100ms)`),
    refusal: (n) => ({
      code: "parse",
      message: `Retry count must be a whole number, 0 or more (got ${n})`,
      text: `${n}, 100ms)`,
    }),
  },
  "an exponential retry count": {
    src: (n) => retry(`exponential(${n}, 100ms, 2.0)`),
    refusal: (n) => ({
      code: "parse",
      message: `Retry count must be a whole number, 0 or more (got ${n})`,
      text: `${n}, 100ms, 2.0)`,
    }),
  },
  "a property-test count": {
    src: propertyTest,
    refusal: (n) => ({
      code: "parse",
      message: `property-test "t" count must be a whole number, 1 or more (got ${n})`,
      text: n,
    }),
  },
  "a motion duration": {
    src: (n) => motion(`duration: ${n}`),
    refusal: (n) => ({
      code: "E0402",
      message: `motion "Fade": duration must be a positive Int (ms) or one of fast/normal/slow`,
      text: `${MOTION_AT}duration: ${n}}`,
    }),
  },
  "a motion iteration": {
    src: (n) => motion(`iteration: ${n}`),
    refusal: (n) => ({
      code: "E0402",
      message: `motion "Fade": iteration must be a positive Int or "infinite"`,
      text: `${MOTION_AT}iteration: ${n}}`,
    }),
  },
  ...Object.fromEntries(
    ["len-eq", "len-lt", "len-gt"].map((pred): [string, Site] => [
      `a ${pred} length`,
      {
        src: (n) => length(pred, n),
        refusal: (n) => ({
          code: "E0804",
          message: `Refinement "${pred}" takes a whole number of characters, zero or more but argument 1 is ${n}`,
          text: `${pred}(${n}) = "ab"`,
        }),
      },
    ]),
  ),
};

const rows = (literals: readonly string[]): [string, string, Site][] =>
  Object.entries(SITES).flatMap(([what, site]) =>
    literals.map((n): [string, string, Site] => [what, n, site]),
  );

describe("a whole number a definition takes", () => {
  it.each(
    rows(["1.0", "2.0", "0.99999999999999999"]),
  )("refuses %s written as %s, as it refuses 0.5, showing the literal as written", (_, n, site) => {
    expect(refusalsOf(site.src(n))).toEqual([site.refusal(n)]);
  });

  it.each(rows(["0.5"]))("refuses %s of %s, as before", (_, n, site) => {
    expect(refusalsOf(site.src(n))).toEqual([site.refusal(n)]);
  });

  it.each(rows(["-1.0"]))("refuses %s written as %s, naming it with its sign", (_, n, site) => {
    expect(refusalsOf(site.src(n))).toEqual([site.refusal(n)]);
  });

  it.each(rows(["1", "2"]))("takes %s written as %s, with no point", (_, n, site) => {
    expect(refusalsOf(site.src(n))).toEqual([]);
  });

  // A repeated key keeps its last value, so the number written before it is not what is checked.
  it("judges a motion duration by its last value when the key is repeated", () => {
    const src = motion(`duration: 300, duration: "soon"`);
    expect(refusalsOf(src).map(({ code, message }) => ({ code, message }))).toEqual([
      { code: "E0402", message: SITES["a motion duration"]?.refusal("").message },
      { code: "E0008", message: `motion key "duration" is written more than once` },
    ]);
  });
});
