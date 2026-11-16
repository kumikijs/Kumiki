import { check, lex, parse } from "@kumikijs/compiler";
import type { AppShape, SlotMeta } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { codesOf, pointedErrorsOf, summariesOf } from "./helpers/diagnostics.ts";
import { compileOrFail, loadApp } from "./helpers/module.ts";
import { withButtonApp, withReducer } from "./helpers/programs.ts";

/** Refuses -1, which every other predicate in a chain accepts: the first of the first definition. */
const FIRST = "between(0, 1000)";
/** Refuses 51: the first of the middle definition. */
const MIDDLE = "between(-1000, 50)";
/** Refuses 8: the last of the last definition. */
const LAST = "one-of(-1, 7, 51)";
/** Every other predicate, which no value used here fails. */
const FILLER = "between(-1000, 1000)";

type ChainShape = {
  /** Each definition is `nominal` over the one below. */
  readonly nominal?: boolean;
  /** Each definition is a generic applying the one below to its own parameter. */
  readonly generic?: boolean;
};

/** Each of -1, 51 and 8 fails exactly one predicate of the chain, 2000 fails every one, 7 none. */
function chain(prefix: string, length: number, wheres: number, shape: ChainShape = {}): string {
  const middle = Math.floor(length / 2);
  const lines: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const preds = Array.from({ length: wheres }, (_, w) => {
      if (i === 0 && w === 0) return FIRST;
      if (i === middle && w === 0) return MIDDLE;
      if (i === length - 1 && w === wheres - 1) return LAST;
      return FILLER;
    });
    const name = shape.generic ? `${prefix}${i}(T)` : `${prefix}${i}`;
    const below = shape.generic ? `${prefix}${i - 1}(T)` : `${prefix}${i - 1}`;
    const over = i > 0 ? below : shape.generic ? "T" : "Int";
    const wrapped = shape.nominal ? `nominal ${over}` : over;
    lines.push(`type ${name} = ${wrapped}${preds.map((p) => ` where ${p}`).join("")}`);
  }
  return lines.join("\n");
}

/** The name at the top of a `chain`. */
const top = (prefix: string, length: number) => `${prefix}${length - 1}`;

/** `x` typed by the top of a chain, and a reducer that writes it. */
const slotOver = (aliases: number, wheres: number) =>
  withReducer(`${chain("T", aliases, wheres)}\nslot x : ${top("T", aliases)} = 7`, "x := x + 1");

async function slotsOf(src: string): Promise<Record<string, SlotMeta>> {
  return (await loadApp<AppShape>(src, "alias-chain")).slots;
}

/** The index, base outward, of the predicate `v` first fails, or -1. */
function firstFailed(meta: SlotMeta, v: number): number {
  return defined(meta.refineAll, "the slot's predicates").findIndex((r) => !r.refine(v));
}

describe("a chain of definitions that each add `where`s to the one before", () => {
  it("compiles forty definitions of 250 `where`s each, and tests every predicate", async () => {
    const x = defined((await slotsOf(slotOver(40, 250))).x, "slot x");
    const refine = defined(x.refine, "x's refinement");
    expect(refine(7)).toBe(true);
    expect(refine(-1)).toBe(false);
    expect(refine(51)).toBe(false);
    expect(refine(8)).toBe(false);
    expect(x.refineAll).toHaveLength(40 * 250);
    expect(firstFailed(x, 7)).toBe(-1);
    expect(firstFailed(x, -1)).toBe(0);
    expect(firstFailed(x, 51)).toBe(20 * 250);
    expect(firstFailed(x, 8)).toBe(40 * 250 - 1);
  }, 60_000);

  const USES: readonly [string, boolean, (t: string) => string][] = [
    [
      "a nominal at every level",
      true,
      (t) => `slot x : ${t} = 7\nreducer w on=ui.click(B) do= x := 8`,
    ],
    [
      "a record field",
      false,
      (t) => `slot r : {v: ${t}} = {v: 7}\nreducer w on=ui.click(B) do= r := {v: 8}`,
    ],
    [
      "a list element",
      false,
      (t) => `slot l : List(${t}) = [7]\nreducer w on=ui.click(B) do= l := [7, 8]`,
    ],
    [
      "a fn's parameter and result",
      false,
      (t) =>
        `slot x : ${t} = 7\nfn keep(a: ${t}) -> ${t} = a\nreducer w on=ui.click(B) do= x := keep(x)`,
    ],
    [
      "two values compared",
      false,
      (t) =>
        `slot x : ${t} = 7\nslot y : ${t} = 7\nreducer w on=ui.click(B) do= if x == y then x := 8`,
    ],
    [
      "a property test's generated value",
      false,
      (t) => `slot x : ${t} = 7
reducer w on=ui.click(B) do= x := 8
test gen =
    property-test
        for-all   = {n: ${t}}
        given     = {slots: {x: 7}, event: {type: ui.click, target: B}}
        invariant = run-reducer(w).slots.x == 8`,
    ],
  ];

  it.each(USES)(
    "compiles forty definitions of 250 `where`s used as %s",
    (_, nominal, use) => {
      const src = withButtonApp(`${chain("T", 40, 250, { nominal })}\n${use(top("T", 40))}`);
      compileOrFail(src, { runtimeSpecifier: "@kumikijs/runtime", includeTests: true });
    },
    60_000,
  );

  it("refuses a value failing the first, a middle or the last of 1,500 definitions' predicates", async () => {
    const x = defined((await slotsOf(slotOver(1500, 1))).x, "slot x");
    expect(x.refineAll).toHaveLength(1500);
    expect(firstFailed(x, 7)).toBe(-1);
    expect(firstFailed(x, -1)).toBe(0);
    expect(firstFailed(x, 51)).toBe(750);
    expect(firstFailed(x, 8)).toBe(1499);
  }, 20_000);

  it.each([1, 0])("compiles a chain of 20,000 definitions of %i `where` each", (wheres) => {
    compileOrFail(slotOver(20_000, wheres));
  }, 60_000);

  it("compiles a property test generating a value typed by the top of 20,000 definitions", () => {
    const src = withReducer(
      `${chain("T", 20_000, 1)}
slot x : T19999 = 7
test gen =
    property-test
        for-all   = {n: T19999}
        given     = {slots: {x: 7}, event: {type: ui.click, target: B}}
        invariant = run-reducer(r).slots.x == 8`,
      "x := 8",
    );
    compileOrFail(src, { runtimeSpecifier: "@kumikijs/runtime", includeTests: true });
  }, 30_000);

  it("refuses a value of the wrong type for the top of a chain of 20,000 definitions", () => {
    const src = withButtonApp(`${chain("T", 20_000, 1)}\nslot x : T19999 = "seven"`);
    expect(codesOf(src)).toEqual(["E0201"]);
  }, 30_000);

  it("refuses a value of the wrong type for a name in a chain another slot's type follows first", () => {
    const src = withButtonApp(
      `${chain("T", 20_000, 1)}\nslot a : T19999 = 7\nslot b : T10000 = "seven"`,
    );
    expect(pointedErrorsOf(src)).toEqual([
      { code: "E0201", message: "Expected T10000 but got Text", text: '"seven"' },
    ]);
  }, 30_000);

  const POSITIONS: readonly [string, (t: string) => string, (v: number) => unknown, unknown][] = [
    ["a record field", (t) => `slot x : {v: ${t}} = {v: 7}`, (v) => ({ v }), "v"],
    ["a list element", (t) => `slot x : List(${t}) = [7]`, (v) => [7, v], 1],
  ];

  it.each(POSITIONS)(
    "compiles a chain of 20,000 definitions under %s, and names the predicate a value fails there",
    async (_, slot, holding, step) => {
      const src = withButtonApp(`${chain("T", 20_000, 1)}\n${slot(top("T", 20_000))}`);
      const x = defined((await slotsOf(src)).x, "slot x");
      const failure = defined(x.refineFailure, "x's walk");
      expect(failure(holding(7))).toBeUndefined();
      expect(failure(holding(-1))).toEqual({ kind: "between", args: [0, 1000], path: [step] });
      expect(failure(holding(51))).toEqual({ kind: "between", args: [-1000, 50], path: [step] });
      expect(failure(holding(8))).toEqual({ kind: "one-of", args: [-1, 7, 51], path: [step] });
      // Failing every predicate, it is named by the first from the base outward.
      expect(failure(holding(2000))).toEqual({ kind: "between", args: [0, 1000], path: [step] });
    },
    60_000,
  );

  it.each([
    [4000, 1],
    [40, 250],
  ])(
    "compiles a chain of %i generics of %i `where` each, each applying the one below, and tests every predicate",
    async (generics, wheres) => {
      const src = withReducer(
        `${chain("G", generics, wheres, { generic: true })}\nslot x : G${generics - 1}(Int) = 7`,
        "x := x + 1",
      );
      const x = defined((await slotsOf(src)).x, "slot x");
      expect(x.refineAll).toHaveLength(generics * wheres);
      expect(firstFailed(x, 7)).toBe(-1);
      expect(firstFailed(x, -1)).toBe(0);
      expect(firstFailed(x, 51)).toBe((generics / 2) * wheres);
      expect(firstFailed(x, 8)).toBe(generics * wheres - 1);
    },
    60_000,
  );

  it("reports once a predicate that a chain of 4,000 generics applies over the wrong type", () => {
    const lines = Array.from(
      { length: 4000 },
      (_, i) => `type G${i}(T) = ${i === 0 ? "T where positive" : `G${i - 1}(T)`}`,
    );
    expect(summariesOf(withButtonApp(`${lines.join("\n")}\nslot x : G3999(Text) = "a"`))).toEqual([
      'E0804 Refinement "positive" tests a number but G3999(Text) applies it over Text, so no value satisfies it',
    ]);
  }, 60_000);
});

describe("a value at a position typed by the names of one chain", () => {
  /** A record whose fields `f0`, `f1`, ... are typed by the names in `order`, each holding 7. */
  const recordOf = (order: readonly string[]) =>
    withButtonApp(`${chain("T", 40, 250)}
slot r : {${order.map((t, i) => `f${i}: ${t}`).join(", ")}} = {${order.map((_, i) => `f${i}: 7`).join(", ")}}`);

  const names = Array.from({ length: 40 }, (_, i) => `T${i}`);
  const topDown = [...names].reverse();

  // A name a walk has passed through is checked by what that walk lowered, not lowered again.
  it("lowers to the same size whether the fields list the chain's names top down or bottom up", () => {
    const bottomUpSize = compileOrFail(recordOf(names)).length;
    const topDownSize = compileOrFail(recordOf(topDown)).length;
    expect(topDownSize).toBeLessThan(1.1 * bottomUpSize);
  }, 60_000);

  it("names the predicate a field fails, by the name that types the field", async () => {
    const r = defined((await slotsOf(recordOf(topDown))).r, "slot r");
    const failure = defined(r.refineFailure, "r's walk");
    const holding = (field: number, v: number) =>
      Object.fromEntries(topDown.map((_, i) => [`f${i}`, i === field ? v : 7]));
    expect(failure(holding(0, 7))).toBeUndefined();
    // Field `fi` is typed by T(39 - i): every name carries FIRST, T20 up MIDDLE, and T39 alone LAST.
    expect(failure(holding(39, -1))).toEqual({ kind: "between", args: [0, 1000], path: ["f39"] });
    expect(failure(holding(39, 51))).toBeUndefined();
    expect(failure(holding(19, 51))).toEqual({
      kind: "between",
      args: [-1000, 50],
      path: ["f19"],
    });
    expect(failure(holding(20, 51))).toBeUndefined();
    expect(failure(holding(0, 8))).toEqual({ kind: "one-of", args: [-1, 7, 51], path: ["f0"] });
    expect(failure(holding(1, 8))).toBeUndefined();
    expect(failure(holding(1, 2000))).toEqual({ kind: "between", args: [0, 1000], path: ["f1"] });
  }, 60_000);
});

describe("how long checking a chain of definitions takes", () => {
  // Linear in a chain's length is the two taking about the same time.
  it("checks one chain of 1,500 in about the time six chains of 250 take", () => {
    const slot = (prefix: string, aliases: number) =>
      `slot ${prefix}x : ${top(prefix, aliases)} = 7`;
    const long = parse(lex(withButtonApp(`${chain("L", 1500, 1)}\n${slot("L", 1500)}`)));
    const short = parse(
      lex(
        withButtonApp(
          ["A", "C", "D", "E", "F", "G"]
            .map((p) => `${chain(p, 250, 1)}\n${slot(p, 250)}`)
            .join("\n"),
        ),
      ),
    );
    expect(check(long)).toEqual([]);
    expect(check(short)).toEqual([]);
    const timed = (program: typeof long): number => {
      const start = performance.now();
      check(program);
      return performance.now() - start;
    };
    // Taken in turn, so a stall on a loaded machine slows one run of each rather than every run of one.
    let sixShort = Number.POSITIVE_INFINITY;
    let oneLong = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 5; i += 1) {
      sixShort = Math.min(sixShort, timed(short));
      oneLong = Math.min(oneLong, timed(long));
    }
    expect(oneLong).toBeLessThan(Math.max(3 * sixShort, 50));
  }, 30_000);
});
