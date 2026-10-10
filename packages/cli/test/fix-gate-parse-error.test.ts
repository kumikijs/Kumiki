import type { KumikiError } from "@kumikijs/compiler";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { gateComposed, rollbackLine } from "../src/fix.ts";

/** A file whose one error is E0001. */
const SOURCE = `tile App = column(heading("hi"))
app A
    caps   = []
    routes = {"/" -> App}
    init   = []
`;

const errors = check(parse(lex(SOURCE))).filter((e) => e.severity !== "warning");

/** What the parser says about `text`, which must not parse. */
function parserMessage(text: string): { message: string; pos: { line: number; col: number } } {
  try {
    parse(lex(text));
  } catch (e) {
    const pos = (e as { pos: { line: number; col: number } }).pos;
    return { message: (e as Error).message, pos };
  }
  throw new Error("the text parses");
}

describe("gateComposed refuses a composed source that does not parse", () => {
  it.each([
    ["does not parse", SOURCE.replace('{"/" -> App}', '{"/" -> App, "/404" -> NotFound')],
    ["does not lex", SOURCE.replace('{"/" -> App}', '{"/" -> App, "/404 -> NotFound}')],
  ])("when it %s, with the parser's message", (_, broken) => {
    expect(errors.map((e) => e.code)).toEqual(["E0001"]);
    const { message, pos } = parserMessage(broken);
    const verdict = gateComposed(errors, broken);
    expect(verdict.blocked).toEqual({ reason: "parse-error", message });
    const synthetic: KumikiError = { code: "E0000", kind: "parse-error", message, pos };
    expect(verdict.remaining).toEqual([...errors, synthetic]);
    expect(rollbackLine({ ...verdict, regressionBlocked: true })).toBe(
      `fixes broke the file: ${message}`,
    );
  });
});
