import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { mountSource } from "./helpers/dom.ts";
import { withApp } from "./helpers/source.ts";

async function rendered(src: string): Promise<string> {
  const { root } = await mountSource(src);
  return root.textContent ?? "";
}

describe("a tile's name in a value position reads the value", () => {
  it.each([
    [
      "text(leaf) reads the slot inside the tile named leaf",
      `slot leaf : Text = "hello"
tile leaf = column(text(leaf))
tile App = column(leaf)`,
    ],
    [
      "Card(leaf) passes the slot as the user tile's input",
      `slot leaf : Text = "hello"
tile Card in=Text = text($1)
tile leaf = column(Card(leaf))
tile App = column(leaf)`,
    ],
  ])("%s", async (_what, defs) => {
    const src = withApp(defs);
    expect(check(parse(lex(src)))).toEqual([]);
    expect(await rendered(src)).toBe("hello");
  });
});
