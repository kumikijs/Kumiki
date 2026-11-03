import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

async function rendered(src: string): Promise<string> {
  const { root } = mountApp(await loadSource(src));
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

describe("a loop through tile positions is still refused", () => {
  it.each([
    {
      what: "uppercase",
      defs: `tile A = column(B)
tile B = column(A)
tile App = column(A)`,
      message: `Tile "A" expands into itself (A → B → A)`,
      at: "1:17",
    },
    {
      // The slots leave E0005 the only diagnostic; without the check, code generation would
      // inline the tiles of the same names into each other.
      what: "lowercase",
      defs: `slot a : Int = 1
slot b : Int = 2
tile a = column(b)
tile b = column(a)
tile App = column(a)`,
      message: `Tile "a" expands into itself (a → b → a)`,
      at: "3:17",
    },
  ])("refuses to build the $what loop", ({ defs, message, at }) => {
    const result = compile(withApp(defs), {
      runtimeSpecifier: "@kumikijs/runtime",
      capabilities: [],
    });
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors.map((e) => [e.code, e.message, `${e.pos.line}:${e.pos.col}`])).toEqual([
      ["E0005", message, at],
    ]);
  });
});
