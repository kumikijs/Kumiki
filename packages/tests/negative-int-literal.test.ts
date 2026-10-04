// language.md §1.2 makes the sign part of an Int literal (`int ::= '-'? [0-9]+`),
// and errors.md E0217 reports a literal JavaScript cannot represent exactly,
// because the program would otherwise run with a value other than the one
// written. The lexer emits the sign as its own operator, so a negative literal
// reaches the checker as a negation, and is held to the same bound all the
// same: `slot lo : Int = -9007199254740993` is E0217, not a slot that builds as
// `-9007199254740992`.
//
// Example 174 writes the negative bound in six of the positions E0217 covers:
// a slot, a record field, a list item, a payload, a `fn` argument and a write.
// Each case here moves one of those literals one past the bound, alone, and
// holds check and build to the answer the unsigned literal in the same place
// gets.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const EXAMPLE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "examples",
  "features",
  "174-negative-int-literal.kumiki",
);

const SOURCE = readFileSync(EXAMPLE, "utf8");
const BOUND = "-9007199254740991";
const PAST = "-9007199254740993";

/** Every `BOUND` the example writes as code, with its 1-based line and column. */
const sites = SOURCE.split("\n").flatMap((text, i) => {
  if (text.trimStart().startsWith("#")) return [];
  const found: { line: number; col: number; label: string }[] = [];
  for (let col = text.indexOf(BOUND); col !== -1; col = text.indexOf(BOUND, col + 1)) {
    found.push({ line: i + 1, col: col + 1, label: text.trim() });
  }
  return found;
});

/** `SOURCE` with the one literal at `site` replaced by `literal`. */
function withLiteral(site: { line: number; col: number }, literal: string): string {
  return SOURCE.split("\n")
    .map((text, i) =>
      i + 1 === site.line
        ? text.slice(0, site.col - 1) + literal + text.slice(site.col - 1 + BOUND.length)
        : text,
    )
    .join("\n");
}

describe("a negative Int literal past the safe range is E0217 wherever the positive one is", () => {
  it("the example writes the bound in six positions and checks clean", () => {
    expect(sites).toHaveLength(6);
    expect(check(parse(lex(SOURCE)))).toEqual([]);
  });

  it.each(sites)("check reports the signed literal at $line:$col ($label)", (site) => {
    const unsigned = check(parse(lex(withLiteral(site, PAST.slice(1)))));
    expect(unsigned.map((e) => [e.code, e.pos])).toEqual([
      ["E0217", { line: site.line, col: site.col }],
    ]);

    expect(check(parse(lex(withLiteral(site, PAST))))).toEqual([
      {
        code: "E0217",
        kind: "int-literal-precision",
        message: `Int literal ${PAST} is not exactly representable and was rounded to -9007199254740992`,
        pos: { line: site.line, col: site.col },
      },
    ]);
  });

  it.each(sites)("build refuses to emit the rounded value at $line:$col ($label)", (site) => {
    const r = compile(withLiteral(site, PAST), { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => e.code)).toEqual(["E0217"]);
  });
});
