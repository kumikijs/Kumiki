import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const codesOf = (fn: string): string[] =>
  check(
    parse(
      lex(`${fn}
tile App = column(text("x"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`),
    ),
  ).map((e) => e.code);

describe("a fn's positionals are its parameters", () => {
  it("types $1 as the first parameter", () => {
    expect(codesOf("fn first(x: Int) -> Text = $1")).toContain("E0201");
  });

  it.each([
    ["a fn with no parameters", "fn noargs() -> Text = $1"],
    ["one past the arity", "fn one(x: Int) -> Int = $2"],
  ])("leaves a positional undefined in %s", (_label, fn) => {
    expect(codesOf(fn)).toContain("E0103");
  });
});
