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

const SRC = `
type Handle  = nominal Text where len-gt(3) where len-lt(9)
type Short   = Text where len-lt(9)
type Chained = nominal Short where len-gt(3)
type Volume  = nominal Int where between(0, 11)
type Address = nominal Text where nonempty where email
type Thread  = {label: Text, replies: List(Thread)}

slot h   : Handle  = "kumiki"
slot c   : Chained = "kumiki"
slot v   : Volume  = 5
slot a   : Address = ""
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

  it("carries each predicate's name and arguments, in source order", () => {
    const m = meta("h");
    expect(m.refineAll).toEqual([
      { kind: "len-gt", args: [3], refine: expect.any(Function) },
      { kind: "len-lt", args: [9], refine: expect.any(Function) },
    ]);
    // `refineKind`/`refineArgs` stay the first predicate, so a consumer that
    // reads only those still names one the type really carries.
    expect(m.refineKind).toBe("len-gt");
    expect(m.refineArgs).toEqual([3]);
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

  it("keeps a predicate with no runtime test from swallowing one that has it", () => {
    // `email` / `uuid` / `url` are not enforced at runtime (spec/testing.md
    // §8.3), so the conjunction is the `nonempty` test alone — but both
    // predicates are still named, because the `error` tile renders from them.
    const refine = refineOf("a");
    expect(refine("")).toBe(false);
    expect(refine("not-an-address")).toBe(true);
    expect(meta("a").refineAll?.map((r) => r.kind)).toEqual(["nonempty", "email"]);
  });

  it("terminates on a type written in terms of itself", () => {
    // A recursive record is legal (§1.3.6, inv. 4), so the walk that collects
    // predicates has to stop at the record rather than follow the name back.
    expect(meta("t").refine).toBeUndefined();
  });
});
