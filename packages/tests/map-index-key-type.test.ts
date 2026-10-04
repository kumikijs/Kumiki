// language.md §1.6.3: an index into a `Map(K, V)` names the entry at the key,
// so the index is a `K`, on both sides of `:=` — as a `List` index is an `Int`.
// A key is accepted the way a value of `K` is (§1.3.5): a `PostId` is no key of
// a `Map(TodoId, V)` although both are declared `nominal Text`, and the literal
// "t2" is one.
//
// The corpus example (`212-map-index-key-type`) reads and writes at keys of
// each Map's key type, and its scenario pins that they work. What this suite
// pins is that each of those indices, respelled as a key of another type, is
// E0201 at the index, by `check` and by `build` alike. The checker's own cases
// are in `packages/compiler/test/lvalue-members.test.ts`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "212-map-index-key-type.kumiki");
const SRC = readFileSync(EXAMPLE, "utf8");

/** The example with its one occurrence of `written` spelled `respelled` instead. */
function respelled(written: string, respelled: string): string {
  expect(SRC.split(written), `"${written}" is written once`).toHaveLength(2);
  return SRC.replace(written, respelled);
}

/** Where the key of the index `[key]` in `respelled` sits in `src`. */
function keyPos(src: string, respelled: string, key: string): { line: number; col: number } {
  const lines = src.split("\n");
  const at = lines.findIndex((l) => l.includes(respelled));
  const line = defined(lines[at], `the line that holds ${respelled}`);
  return { line: at + 1, col: line.indexOf(respelled) + respelled.indexOf(`[${key}]`) + 2 };
}

describe("the index of a Map(K, V) is a K", () => {
  it("leaves the example's own keys alone", () => {
    expect(check(parse(lex(SRC))).map((e) => e.code)).toEqual([]);
  });

  it.each([
    ["a read", "shown := notes[todo]", "shown := notes[post]", "post", "TodoId", "PostId"],
    ["a write", 'notes[todo] := "edited"', 'notes[post] := "edited"', "post", "TodoId", "PostId"],
    [
      "a write through the entry",
      "todos[todo].done := true",
      "todos[post].done := true",
      "post",
      "TodoId",
      "PostId",
    ],
    [
      "a read in a tile",
      '"t1: " + notes[todo]',
      '"t1: " + notes[post]',
      "post",
      "TodoId",
      "PostId",
    ],
    ["a read of a Text-keyed Map", 'counts["a"] + 1', "counts[1] + 1", "1", "Text", "Int"],
    [
      "a write into a Text-keyed Map",
      'counts["a"] := counts',
      "counts[1] := counts",
      "1",
      "Text",
      "Int",
    ],
  ])("refuses another key type in %s, by check and by build", (_what, written, wrong, key, k, got) => {
    const src = respelled(written, wrong);
    const errs = check(parse(lex(src)));
    expect(errs.map((e) => e.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe(`Expected ${k} but got ${got}`);
    expect(errs[0]?.pos).toEqual(keyPos(src, wrong, key));
    const built = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(built.kind).toBe("fail");
    if (built.kind !== "fail") return;
    expect(built.errors.map((e) => e.code)).toEqual(["E0201"]);
  });
});
