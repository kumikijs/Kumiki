// A type's predicates accumulate over every name it is declared through
// (spec/language.md §1.3.1), and the parser's depth budget (§1.2.3) bounds only
// the `where`s written on one type expression: its refusal says to move part of
// the chain into a definition of its own. Nothing bounds how many definitions a
// chain passes through, so the predicates one type carries are its names times
// their `where`s, and checking and building it walk all of them.
//
// What is pinned here is that such a chain is a program like any other: it
// compiles, every predicate it collects is still a test the built slot runs,
// and checking it takes time in proportion to its length.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import type { AppShape, SlotMeta } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

const TAIL = `tile Btn = button(text="+")
tile App = column(heading("chain"), Btn)
app Chain caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

/** Refuses -1, which every other predicate in a chain accepts: the first of the first definition. */
const FIRST = "between(0, 1000)";
/** Refuses 51: the first of the middle definition. */
const MIDDLE = "between(-1000, 50)";
/** Refuses 8: the last of the last definition. */
const LAST = "one-of(-1, 7, 51)";
/** Every other predicate, which no value used here fails. */
const FILLER = "between(-1000, 1000)";

/**
 * `aliases` definitions named `<prefix>0` …, each written over the one before
 * — `nominal`ly, when asked — and adding `wheres` predicates of its own, over
 * `Int`. Each of -1, 51 and 8 fails exactly one predicate (the first
 * definition's first, the middle definition's first, the last definition's
 * last), and 7 fails none.
 */
function chain(prefix: string, aliases: number, wheres: number, nominal = false): string {
  const middle = Math.floor(aliases / 2);
  const lines: string[] = [];
  for (let i = 0; i < aliases; i += 1) {
    const preds = Array.from({ length: wheres }, (_, w) => {
      if (i === 0 && w === 0) return FIRST;
      if (i === middle && w === 0) return MIDDLE;
      if (i === aliases - 1 && w === wheres - 1) return LAST;
      return FILLER;
    });
    const over = i === 0 ? "Int" : `${prefix}${i - 1}`;
    const wrapped = nominal ? `nominal ${over}` : over;
    lines.push(`type ${prefix}${i} = ${wrapped}${preds.map((p) => ` where ${p}`).join("")}`);
  }
  return lines.join("\n");
}

/** The name at the top of a `chain`. */
const top = (prefix: string, aliases: number) => `${prefix}${aliases - 1}`;

/** A program declaring `decls`, with a button to hang writes on. */
const program = (decls: string) => `${decls}\n${TAIL}`;

/** `x` typed by the top of a chain, and a reducer that writes it. */
const slotOver = (aliases: number, wheres: number) =>
  program(
    `${chain("T", aliases, wheres)}
slot x : ${top("T", aliases)} = 7
reducer bump on=ui.click(Btn) do= x := x + 1`,
  );

async function slotsOf(src: string): Promise<Record<string, SlotMeta>> {
  const result = compile(src, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
  if (result.kind !== "ok") throw new Error(JSON.stringify(result.errors));
  const dir = mkdtempSync(join(TMP_ROOT, "alias-chain-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, result.js);
  const mod: { default: AppShape } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  return mod.default.slots;
}

/**
 * Where among a slot's predicates, read from the base outward, `v` first fails
 * — the predicate a rejection names (§1.3.1) — or -1 when it fails none.
 */
function firstFailed(meta: SlotMeta, v: number): number {
  return defined(meta.refineAll, "the slot's predicates").findIndex((r) => !r.refine(v));
}

describe("a chain of definitions that each add `where`s to the one before", () => {
  // Every definition within the depth budget, and 10,000 predicates on the
  // type at the top.
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

  // The same chain reached every other way a type is read: each is a walk of
  // its own through the chain, in the checker or in codegen.
  const USES: readonly [string, boolean, (t: string) => string][] = [
    [
      "a nominal at every level",
      true,
      (t) => `slot x : ${t} = 7\nreducer w on=ui.click(Btn) do= x := 8`,
    ],
    [
      "a record field",
      false,
      (t) => `slot r : {v: ${t}} = {v: 7}\nreducer w on=ui.click(Btn) do= r := {v: 8}`,
    ],
    [
      "a list element",
      false,
      (t) => `slot l : List(${t}) = [7]\nreducer w on=ui.click(Btn) do= l := [7, 8]`,
    ],
    [
      "a fn's parameter and result",
      false,
      (t) =>
        `slot x : ${t} = 7\nfn keep(a: ${t}) -> ${t} = a\nreducer w on=ui.click(Btn) do= x := keep(x)`,
    ],
    [
      "two values compared",
      false,
      (t) =>
        `slot x : ${t} = 7\nslot y : ${t} = 7\nreducer w on=ui.click(Btn) do= if x == y then x := 8`,
    ],
    [
      "a property test's generated value",
      false,
      (t) => `slot x : ${t} = 7
reducer w on=ui.click(Btn) do= x := 8
test gen =
    property-test
        for-all   = {n: ${t}}
        given     = {slots: {x: 7}, event: {type: ui.click, target: Btn}}
        invariant = run-reducer(w).slots.x == 8`,
    ],
  ];

  it.each(USES)(
    "compiles forty definitions of 250 `where`s used as %s",
    (_, nominal, use) => {
      const src = program(`${chain("T", 40, 250, nominal)}\n${use(top("T", 40))}`);
      const result = compile(src, { runtimeSpecifier: "@kumikijs/runtime", includeTests: true });
      expect(result.kind === "fail" ? result.errors : []).toEqual([]);
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

  // More definitions than the call stack has frames for, with a `where` on
  // each and with none at all.
  it.each([1, 0])("compiles a chain of 20,000 definitions of %i `where` each", (wheres) => {
    const result = compile(slotOver(20_000, wheres), { runtimeSpecifier: "@kumikijs/runtime" });
    expect(result.kind === "fail" ? result.errors : []).toEqual([]);
  }, 60_000);

  // The same chain one position down. A slot whose type carries a predicate
  // below its own chain is gated by a walk of the value (§1.3.3), which
  // follows the chain at that position to its end too — when it is built, and
  // when it checks a value.
  const POSITIONS: readonly [string, (t: string) => string, (v: number) => unknown, unknown][] = [
    ["a record field", (t) => `slot x : {v: ${t}} = {v: 7}`, (v) => ({ v }), "v"],
    ["a list element", (t) => `slot x : List(${t}) = [7]`, (v) => [7, v], 1],
  ];

  it.each(POSITIONS)(
    "compiles a chain of 20,000 definitions under %s, and names the predicate a value fails there",
    async (_, slot, holding, step) => {
      const src = program(`${chain("T", 20_000, 1)}\n${slot(top("T", 20_000))}`);
      const x = defined((await slotsOf(src)).x, "slot x");
      const failure = defined(x.refineFailure, "x's walk");
      expect(failure(holding(7))).toBeUndefined();
      expect(failure(holding(-1))).toEqual({ kind: "between", args: [0, 1000], path: [step] });
      expect(failure(holding(51))).toEqual({ kind: "between", args: [-1000, 50], path: [step] });
      expect(failure(holding(8))).toEqual({ kind: "one-of", args: [-1, 7, 51], path: [step] });
    },
    60_000,
  );

  // A chain of generics, each applied to its parameter and adding `where`s.
  // A generic's parameter is judged where the generic is applied (§1.3.3), so
  // an application's arguments are judged against every refinement its body
  // puts over them, through every generic below it: a long chain of them, or a
  // shorter one with many `where`s at each level, is more than the call stack
  // holds when each level and each `where` is a call.
  it.each([
    [2000, 1],
    [40, 250],
  ])(
    "compiles a chain of %i generics of %i `where` each, each applying the one below",
    (generics, wheres) => {
      const lines = Array.from(
        { length: generics },
        (_, i) =>
          `type G${i}(T) = ${i === 0 ? "T" : `G${i - 1}(T)`}${" where between(0, 1000)".repeat(wheres)}`,
      );
      const src = program(`${lines.join("\n")}\nslot x : G${generics - 1}(Int) = 5`);
      const result = compile(src, { runtimeSpecifier: "@kumikijs/runtime" });
      expect(result.kind === "fail" ? result.errors : []).toEqual([]);
    },
    30_000,
  );
});

describe("how long checking a chain of definitions takes", () => {
  /** The fastest of `runs` checks of `src`, in milliseconds, after one that warms up. */
  const fastest = (src: string, runs: number): number => {
    const parsed = parse(lex(src));
    expect(check(parsed)).toEqual([]);
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      check(parsed);
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };

  // The same 1,500 definitions and `where`s either way, as one chain or as six
  // chains of 250. Linear in a chain's length is the two taking about the same
  // time; a walk of the whole chain below at every definition makes the long
  // one six times slower, and a copy of every name walked so far at each step
  // of that walk thirty-six.
  it("checks one chain of 1,500 in about the time six chains of 250 take", () => {
    const slot = (prefix: string, aliases: number) =>
      `slot ${prefix}x : ${top(prefix, aliases)} = 7`;
    const long = program(`${chain("L", 1500, 1)}\n${slot("L", 1500)}`);
    const short = program(
      ["A", "B", "C", "D", "E", "F"].map((p) => `${chain(p, 250, 1)}\n${slot(p, 250)}`).join("\n"),
    );
    const sixShort = fastest(short, 3);
    const oneLong = fastest(long, 3);
    expect(oneLong).toBeLessThan(Math.max(3 * sixShort, 50));
  }, 30_000);
});
