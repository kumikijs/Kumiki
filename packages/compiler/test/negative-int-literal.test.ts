import { readFileSync } from "node:fs";
import { compile } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";

const SOURCE = readFileSync(feature("174-negative-int-literal"), "utf8");
const BOUND = "-9007199254740991";
const PAST = "-9007199254740993";

const sites = SOURCE.split("\n").flatMap((text, i) => {
  if (text.trimStart().startsWith("#")) return [];
  const found: { line: number; col: number; label: string }[] = [];
  for (let col = text.indexOf(BOUND); col !== -1; col = text.indexOf(BOUND, col + 1)) {
    found.push({ line: i + 1, col: col + 1, label: text.trim() });
  }
  return found;
});

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
    expect(checkSource(SOURCE)).toEqual([]);
  });

  it.each(sites)("check reports the signed literal at $line:$col ($label)", (site) => {
    const unsigned = checkSource(withLiteral(site, PAST.slice(1)));
    expect(unsigned.map((e) => [e.code, e.pos])).toEqual([
      ["E0217", { line: site.line, col: site.col }],
    ]);

    expect(checkSource(withLiteral(site, PAST))).toEqual([
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
