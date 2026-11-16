import { describe, expect, it } from "vitest";
import {
  type KumikiError,
  LexError,
  lex,
  ParseError,
  parse,
  parseFailure,
  severityOf,
} from "../src/index.ts";

describe("severityOf", () => {
  it.each([
    { given: "an omitted severity", diagnostic: {}, severity: "error" },
    { given: "a warning", diagnostic: { severity: "warning" }, severity: "warning" },
    { given: "an explicit error", diagnostic: { severity: "error" }, severity: "error" },
  ] as const)("reads $given as $severity", ({ diagnostic, severity }) => {
    expect(severityOf(diagnostic)).toBe(severity);
  });
});

describe("parseFailure", () => {
  const thrownBy = (source: string): unknown => {
    try {
      parse(lex(source));
    } catch (e) {
      return e;
    }
    throw new Error(`${JSON.stringify(source)} parsed`);
  };

  it.each([
    [
      "a parse throw",
      "tile App = column(",
      ParseError,
      "Parse error at 1:19:",
      { line: 1, col: 19 },
    ],
    ["a lex throw", 'tile App = text("a)', LexError, "Lex error at 1:17:", { line: 1, col: 17 }],
  ])("turns %s into an E0000 error at the throw's position", (_, source, kind, head, pos) => {
    const thrown = thrownBy(source);
    expect(thrown).toBeInstanceOf(kind);
    const failure = parseFailure(thrown);
    expect(failure).toEqual({
      code: "E0000",
      kind: "parse-error",
      message: (thrown as Error).message,
      pos,
    } satisfies KumikiError);
    expect(failure.message.startsWith(head)).toBe(true);
    expect(severityOf(failure)).toBe("error");
  });

  it.each([
    ["a thrown string", "boom", "boom"],
    ["an Error with no position", new Error("boom"), "boom"],
  ])("places %s at 0:0, keeping its text", (_, thrown, message) => {
    expect(parseFailure(thrown)).toEqual({
      code: "E0000",
      kind: "parse-error",
      message,
      pos: { line: 0, col: 0 },
    });
  });
});
