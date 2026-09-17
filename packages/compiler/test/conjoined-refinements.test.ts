// A type may carry more than one `where`, and the predicates conjoin
// (spec/language.md §1.3.1). Codegen used to read exactly one layer, so
//
//     type Handle = nominal Text where len-gt(3) where len-lt(9)
//
// emitted the outer test alone and the slot accepted `"ab"` — a value its own
// type says is too short, with `check`, `build` and the emitted descriptor all
// looking well formed (#353).
//
// The layers a predicate can hide behind are the ones normalization already
// follows: a second `where`, the `where` folded onto a `nominal` node, and a
// named type reached through either. `assignable.ts` peels all of them to
// answer "is this nominal"; these tests hold codegen to the same reading.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import type { AppShape, SlotMeta } from "@kumikijs/runtime";
import { beforeAll, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

// `Chained` is declared BEFORE the `Short` it is written over, so a walk that
// read declaration order rather than the chain would order its predicates the
// other way round. `Bare` carries no `where` of its own — the layer whose
// refinement used to be the only one emitted, and now the one that contributes
// none. `Tight` is three predicates through two names: the N-way conjunction.
const SRC = `
type Handle  = nominal Text where len-gt(3) where len-lt(9)
type Chained = nominal Short where len-gt(3)
type Short   = Text where len-lt(9)
type Bare    = nominal Short
type Tight   = nominal Short where len-gt(3) where nonempty
type Volume  = nominal Int where between(0, 11)
type Address = nominal Text where nonempty where email
type Opaque  = nominal Text where email where uuid
type Both    = Text where len-gt(3) where len-lt(9)
type Triple  = nominal Text where len-gt(3) where len-lt(9) where nonempty
type Thread  = {label: Text, replies: List(Thread)}

slot h   : Handle  = "kumiki"
slot c   : Chained = "kumiki"
slot b   : Bare    = "kumiki"
slot g   : Tight   = "kumiki"
slot v   : Volume  = 5
slot a   : Address = ""
slot o   : Opaque  = ""
slot d   : Both    = "kumiki"
slot p   : Triple  = "kumiki"
slot n   : Int     = 1
slot t   : Thread  = {label: "root", replies: []}

tile App = text("x")

app Refined
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

let slots: Record<string, SlotMeta>;

// One compile and one module load for the whole file: the generated module
// imports the runtime, and a cold resolve of it is the slow part.
beforeAll(async () => {
  const result = compile(SRC, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
  if (result.kind !== "ok") throw new Error(JSON.stringify(result.errors));
  const dir = mkdtempSync(join(TMP_ROOT, "refine-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, result.js);
  const mod: { default: AppShape } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  slots = mod.default.slots;
}, 30_000);

const meta = (name: string): SlotMeta => defined(slots[name], `slot "${name}"`);
const refineOf = (name: string): ((v: unknown) => boolean) =>
  defined(meta(name).refine, `slot "${name}"'s refinement`);

describe("a type's predicates conjoin", () => {
  it("tests every `where` a type carries, not just the outermost", () => {
    const refine = refineOf("h");
    expect(refine("kumiki")).toBe(true);
    // The inner predicate is the one that used to be dropped.
    expect(refine("ab")).toBe(false);
    expect(refine("kumikijs!")).toBe(false);
  });

  it("collects the predicates a named type hides behind an alias chain", () => {
    const refine = refineOf("c");
    expect(refine("kumiki")).toBe(true);
    expect(refine("ab")).toBe(false);
    expect(refine("kumikijs!")).toBe(false);
  });

  it("carries each predicate's name and arguments, base outward", () => {
    const m = meta("h");
    expect(m.refineAll).toEqual([
      { kind: "len-gt", args: [3], refine: expect.any(Function) },
      { kind: "len-lt", args: [9], refine: expect.any(Function) },
    ]);
    // `refineKind`/`refineArgs` are the first of that order, so a consumer that
    // reads only those still names one the type really carries.
    expect(m.refineKind).toBe("len-gt");
    expect(m.refineArgs).toEqual([3]);
  });

  it("orders a chain by what it is declared over, not by declaration order", () => {
    // `Chained` is `nominal Short where len-gt(3)` and is declared ABOVE
    // `Short`. The base comes first either way: the order is the chain's, and
    // moving either definition in the file does not change it.
    expect(meta("c").refineAll?.map((r) => r.kind)).toEqual(["len-lt", "len-gt"]);
    expect(meta("c").refineKind).toBe("len-lt");
  });

  it("conjoins three predicates reached through two names", () => {
    // `bodies.length > 1` is the N-way arm; two predicates would also reach it,
    // but nothing pinned it past two.
    const m = meta("g");
    expect(m.refineAll?.map((r) => r.kind)).toEqual(["len-lt", "len-gt", "nonempty"]);
    const refine = refineOf("g");
    expect(refine("kumiki")).toBe(true);
    expect(refine("ab")).toBe(false); // len-gt(3)
    expect(refine("kumikijs!")).toBe(false); // len-lt(9)
    expect(refine("")).toBe(false); // nonempty (and len-gt)
  });

  it("collects the predicates of a layer that carries no `where` of its own", () => {
    // `type Bare = nominal Short` is the shape that changed most: on `dev` the
    // one layer read had no refinement, so the slot was emitted with no
    // `refine` at all and every write landed.
    const m = meta("b");
    expect(m.refineKind).toBe("len-lt");
    expect(m.refineAll).toBeUndefined(); // `Short` carries exactly one
    expect(refineOf("b")("kumikijs!")).toBe(false);
  });

  it("leaves a single-predicate slot exactly as it was", () => {
    const m = meta("v");
    expect(m.refineAll).toBeUndefined();
    expect(m.refineKind).toBe("between");
    expect(m.refineArgs).toEqual([0, 11]);
    expect(refineOf("v")(12)).toBe(false);
  });

  it("emits no refinement for a type that carries none", () => {
    expect(meta("n").refine).toBeUndefined();
    expect(meta("n").refineAll).toBeUndefined();
  });

  it("makes every predicate in the chain a test of its own", () => {
    // `email` had no lowering while this was written, so the conjunction was
    // the `nonempty` test alone and `a := "not-an-address"` landed on a type
    // that says otherwise. All twelve predicates lower now (#352), so the
    // conjunction refuses a value failing either one — and `refineAll` still
    // names them in chain order, each entry testing its own predicate.
    const refine = refineOf("a");
    expect(refine("")).toBe(false); // nonempty (and email)
    expect(refine("not-an-address")).toBe(false); // email
    expect(refine("ada@example.com")).toBe(true);
    const parts = defined(meta("a").refineAll, "a's predicates");
    expect(parts.map((r) => r.kind)).toEqual(["nonempty", "email"]);
    expect(defined(parts[1], "the email entry").refine("")).toBe(false);
  });

  it("refuses every value when the predicates it conjoins share none", () => {
    // `email where uuid` is legal and satisfied by nothing — a uuid carries no
    // `@`. It used to emit a tautology, so the slot took anything; a
    // conjunction of two real tests means it now takes nothing, and the
    // descriptor still names both. A type no value inhabits is the author's to
    // fix, and reading it off the descriptor is how they see it.
    const refine = refineOf("o");
    expect(refine("")).toBe(false);
    expect(refine("ada@example.com")).toBe(false);
    expect(refine("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(false);
    expect(meta("o").refineAll?.map((r) => r.kind)).toEqual(["email", "uuid"]);
  });

  it("collects three predicates written on one type expression", () => {
    // The parser chains `where` without a bound (§1.3.1), so a type expression
    // can carry more than the two a pair of `if`s used to admit — and all three
    // reach the descriptor.
    expect(meta("p").refineAll?.map((r) => r.kind)).toEqual(["len-gt", "len-lt", "nonempty"]);
    const refine = refineOf("p");
    expect(refine("kumiki")).toBe(true);
    expect(refine("kumikijs!")).toBe(false);
  });

  it("reads a `where` chain written without `nominal`", () => {
    // The parser takes the first `where` onto the atom and loops the rest, so
    // an unnamed refinement chain collects the same way a nominal one does.
    const refine = refineOf("d");
    expect(refine("kumiki")).toBe(true);
    expect(refine("ab")).toBe(false);
    expect(refine("kumikijs!")).toBe(false);
  });

  it("terminates on a type written in terms of itself", () => {
    // A recursive record is legal (§1.3.6, inv. 4), so the walk that collects
    // predicates has to stop at the record rather than follow the name back.
    expect(meta("t").refine).toBeUndefined();
  });
});
