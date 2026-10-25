import { lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const program = (defs: string) =>
  withApp(`type C = Red | Blue
slot c : C = Blue
tile Go = button(text="go")
${defs}`);

function noArmsAt(src: string): string {
  const at = src.indexOf("match");
  const before = src.slice(0, at);
  const line = before.split("\n").length;
  const col = at - before.lastIndexOf("\n");
  return `Parse error at ${line}:${col}: match requires at least one arm`;
}

describe("a match with no arms is a parse error at the match", () => {
  it.each([
    ["a tile body", `tile Pick = match c with\ntile App = column(Go, Pick, text("after"))`],
    ["a tile's child", `tile App = column(Go, match c with, text("after"))`],
    [
      "a reducer statement",
      `reducer r on=ui.click(Go) do= match c with\ntile App = column(Go, text("after"))`,
    ],
    ["a value builtin's content", `tile App = column(Go, text(match c with))`],
    ["a fn body", `fn f(x: C) -> Int = match x with\ntile App = column(Go, text("after"))`],
  ])("in %s", async (_where, defs) => {
    const src = program(defs);
    expect(() => parse(lex(src))).toThrow(noArmsAt(src));
    await expect(loadSource(src)).rejects.toThrow(noArmsAt(src));
  });
});
