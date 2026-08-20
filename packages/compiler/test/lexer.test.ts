import { LexError, lex } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// Every token but `eof` carries a value, and `eof` is filtered out — so one
// shape covers them all.
const tokenSummary = (s: string) =>
  lex(s)
    .filter((t) => t.kind !== "eof")
    .map((t) => `${t.kind}(${t.value})`);

describe("lexer", () => {
  it("tokenizes a slot declaration", () => {
    expect(tokenSummary("slot count : N = 0")).toEqual([
      "kw(slot)",
      "ident(count)",
      "op(:)",
      "ident(N)",
      "op(=)",
      "num(0)",
    ]);
  });

  it("skips line comments", () => {
    expect(tokenSummary("# hello\nx")).toEqual(["ident(x)"]);
  });

  it("handles string concatenation tokens", () => {
    expect(tokenSummary('"hi" + "world"')).toEqual(["str(hi)", "op(+)", "str(world)"]);
  });

  it("recognizes nominal + refinement keywords and parens", () => {
    expect(tokenSummary("nominal Int where between(0, 999)")).toEqual([
      "kw(nominal)",
      "ident(Int)",
      "kw(where)",
      "ident(between)",
      "op(()",
      "num(0)",
      "op(,)",
      "num(999)",
      "op())",
    ]);
  });

  it("handles := and += tokens (do-block)", () => {
    expect(tokenSummary("do= count := count + 1")).toEqual([
      "kw(do)",
      "op(=)",
      "ident(count)",
      "op(:=)",
      "ident(count)",
      "op(+)",
      "num(1)",
    ]);
  });

  it("rejects identifiers longer than 32 characters", () => {
    const bad = "a".repeat(33);
    expect(() => lex(bad)).toThrow(LexError);
  });

  it("handles escaped characters in strings", () => {
    const toks = lex('"a\\nb"');
    expect(toks[0]).toMatchObject({ kind: "str", value: "a\nb" });
  });

  it("tracks line/col positions", () => {
    const toks = lex("x\n  y");
    expect(toks[0]).toMatchObject({ kind: "ident", value: "x", pos: { line: 1, col: 1 } });
    expect(toks[1]).toMatchObject({ kind: "ident", value: "y", pos: { line: 2, col: 3 } });
  });

  it("supports dot, hash, and arrow operators", () => {
    expect(tokenSummary('"/" -> App')).toEqual(["str(/)", "op(->)", "ident(App)"]);
    expect(tokenSummary("TileName#id")).toEqual(["ident(TileName)", "op(#)", "ident(id)"]);
    expect(tokenSummary("a.b")).toEqual(["ident(a)", "op(.)", "ident(b)"]);
  });

  it("emits `@` as a single-char op for theme-token references (style.md §4.3)", () => {
    expect(tokenSummary("@colors.surface")).toEqual([
      "op(@)",
      "ident(colors)",
      "op(.)",
      "ident(surface)",
    ]);
  });
});
