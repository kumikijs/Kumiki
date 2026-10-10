import { readFileSync } from "node:fs";
import { compile } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { checkSource, codesOf, textAt } from "./helpers/diagnostics.ts";

const SRC = readFileSync(feature("180-index-write-places"), "utf8");

/** The example with its one `write` statement spelled `indexed` instead. */
function respelled(write: string, indexed: string): string {
  expect(SRC.split(`do= ${write}\n`), `"${write}" is written once`).toHaveLength(2);
  return SRC.replace(`do= ${write}\n`, `do= ${indexed}\n`);
}

describe("an index write into a receiver with no places", () => {
  it.each([
    ["a record", "rec.a := 2", 'rec["a"] := "oops"', "Counter"],
    ["an Option", "maybe.get := 5", "maybe[0] := 5", "Option(Int)"],
    ["an Int", "n := 7", "n[0] := 7", "Int"],
    ["a Text", 'word := "z"', 'word[0] := "z"', "Text"],
    ["a List's Int element", "xs[0] := 9", "xs[0][0] := 9", "Int"],
  ])("is refused on %s by check and by build", (_what, write, indexed, into) => {
    const src = respelled(write, indexed);
    const errs = checkSource(src);
    expect(errs.map((e) => e.code)).toEqual(["E0602"]);
    expect(errs[0]?.message).toContain(`Cannot assign through an index into "${into}"`);
    expect(textAt(src, defined(errs[0], "an E0602").pos)).toBe(
      indexed.slice(indexed.lastIndexOf("[")),
    );
    const built = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(built.kind === "fail" ? built.errors.map((e) => e.code) : []).toEqual(["E0602"]);
  });

  it("answers a record key that is one of its fields with the field step", () => {
    const errs = checkSource(respelled("rec.a := 2", 'rec["a"] := "oops"'));
    expect(errs[0]?.message).toContain('write the field step ".a"');
    expect(codesOf(respelled("rec.a := 2", 'rec.a := "oops"'))).toEqual(["E0201"]);
  });
});
