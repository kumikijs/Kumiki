// The regression gate refuses a composed source that does not parse, and says
// so with the parser's own message.
//
// No repair rule writes such a source today, which is the point of the rule:
// it is what keeps a defect in a future rule from reaching disk. Nothing a test
// can put in a file reaches it, so the gate is a pure function of the errors
// the file has and the text a plan composed, and it is given hand-written
// broken text here. It takes no path, so it cannot write; `applyFixPlan` writes
// only on the verdict that is not `blocked`.

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
    // The file keeps every error it had, plus the parse error the write would
    // have caused, so an empty `remaining` still means a clean file.
    const synthetic: KumikiError = { code: "E0000", kind: "parse-error", message, pos };
    expect(verdict.remaining).toEqual([...errors, synthetic]);
    // The line `fix --apply` and `fix --auto-patch` print for it names the
    // breakage, not a rollback.
    expect(rollbackLine({ ...verdict, regressionBlocked: true })).toBe(
      `fixes broke the file: ${message}`,
    );
  });
});
