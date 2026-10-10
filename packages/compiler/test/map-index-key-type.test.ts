import { readFileSync } from "node:fs";
import { compile } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

const SRC = readFileSync(feature("212-map-index-key-type"), "utf8");

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
    expect(codesOf(SRC)).toEqual([]);
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
    const errs = checkSource(src);
    expect(errs.map((e) => e.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe(`Expected ${k} but got ${got}`);
    expect(errs[0]?.pos).toEqual(keyPos(src, wrong, key));
    const built = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(built.kind).toBe("fail");
    if (built.kind !== "fail") return;
    expect(built.errors.map((e) => e.code)).toEqual(["E0201"]);
  });
});
