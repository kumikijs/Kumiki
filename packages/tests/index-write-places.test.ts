// language.md §1.6.3: an index step names a place only in a Map (the entry) or
// a List (the element). Any other receiver whose type is known has no place for
// it to name, so an index write into one is E0602, the code a Set index gets.
//
// Let through, such a write checks its right-hand side against nothing:
// `rec["a"] := "oops"` would put a Text in the Int field `a`, so a later
// `rec.a + 1` concatenates, and the same write on an `Int` or a `Text` would
// panic at run time. The corpus example (`180-index-write-places`) makes each write
// the way that names a place, and its scenario pins that they keep working.
// What this suite pins is that the index spelling of each one is refused, at
// the step, by `check` and by `build` alike. The checker's own cases are in
// `packages/compiler/test/lvalue-members.test.ts`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "180-index-write-places.kumiki");
const SRC = readFileSync(EXAMPLE, "utf8");

/** The example with its one `write` statement spelled `indexed` instead. */
function respelled(write: string, indexed: string): string {
  expect(SRC.split(`do= ${write}\n`), `"${write}" is written once`).toHaveLength(2);
  return SRC.replace(`do= ${write}\n`, `do= ${indexed}\n`);
}

/** Where the last `[` of `indexed` sits in `src` — the step with no place. */
function stepPos(src: string, indexed: string): { line: number; col: number } {
  const lines = src.split("\n");
  const at = lines.findIndex((l) => l.endsWith(`do= ${indexed}`));
  const line = defined(lines[at], `the line that writes ${indexed}`);
  return { line: at + 1, col: line.length - indexed.length + indexed.lastIndexOf("[") + 1 };
}

describe("an index write into a receiver with no places", () => {
  it("leaves the example's own writes alone", () => {
    expect(check(parse(lex(SRC))).map((e) => e.code)).toEqual([]);
  });

  it.each([
    ["a record", "rec.a := 2", 'rec["a"] := "oops"', "Counter"],
    ["an Option", "maybe.get := 5", "maybe[0] := 5", "Option(Int)"],
    ["an Int", "n := 7", "n[0] := 7", "Int"],
    ["a Text", 'word := "z"', 'word[0] := "z"', "Text"],
    ["a List's Int element", "xs[0] := 9", "xs[0][0] := 9", "Int"],
  ])("is refused on %s by check and by build", (_what, write, indexed, into) => {
    const src = respelled(write, indexed);
    const errs = check(parse(lex(src)));
    expect(errs.map((e) => e.code)).toEqual(["E0602"]);
    expect(errs[0]?.message).toContain(`Cannot assign through an index into "${into}"`);
    expect(errs[0]?.pos).toEqual(stepPos(src, indexed));
    const built = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(built.kind).toBe("fail");
    if (built.kind !== "fail") return;
    expect(built.errors.map((e) => e.code)).toEqual(["E0602"]);
  });

  // The field-path spelling of the reported write is refused by the field's
  // type; the index spelling is refused as naming no place, and pointed at the
  // field step.
  it("answers a record key that is one of its fields with the field step", () => {
    const errs = check(parse(lex(respelled("rec.a := 2", 'rec["a"] := "oops"'))));
    expect(errs[0]?.message).toContain('write the field step ".a"');
    const field = check(parse(lex(respelled("rec.a := 2", 'rec.a := "oops"'))));
    expect(field.map((e) => e.code)).toEqual(["E0201"]);
  });
});
