// A slot and a tile may share a name (errors.md E0007), and which one a bare
// name means is decided by where it is written. As a positional argument of a
// builtin that renders tiles there (`column(leaf)`), it is the tile, inlined.
// As a value builtin's content (`text(leaf)`) or a user tile's input
// (`Card(leaf)`), it is a value — the slot — and nothing is inlined, so it
// closes no loop (E0005). Each program below is checked, built, mounted, and
// shows the slot's value; the loops written with tile names in tile positions
// are refused, uppercase or lowercase. The checker's cases are in
// `packages/compiler/test/cycles.test.ts`.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.js";

const TAIL = `app M
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

const diags = (src: string) => check(parse(lex(src)));

async function rendered(src: string): Promise<string> {
  const app = await loadSource(src);
  const target = document.createElement("div");
  document.body.appendChild(target);
  mount(app, target);
  return target.textContent ?? "";
}

describe("a tile's name in a value position reads the value", () => {
  it("text(leaf) reads the slot inside the tile named leaf", async () => {
    const src = `slot leaf : Text = "hello"
tile leaf = column(text(leaf))
tile App = column(leaf)
${TAIL}`;
    expect(diags(src)).toEqual([]);
    expect(await rendered(src)).toBe("hello");
  });

  it("Card(leaf) passes the slot as the user tile's input", async () => {
    const src = `slot leaf : Text = "hello"
tile Card in=Text = text($1)
tile leaf = column(Card(leaf))
tile App = column(leaf)
${TAIL}`;
    expect(diags(src)).toEqual([]);
    expect(await rendered(src)).toBe("hello");
  });
});

describe("a loop through tile positions is still refused", () => {
  const LOOPS: readonly { what: string; source: string; message: string; at: string }[] = [
    {
      what: "uppercase",
      source: `tile A = column(B)
tile B = column(A)
tile App = column(A)
${TAIL}`,
      message: `Tile "A" expands into itself (A → B → A)`,
      at: "1:17",
    },
    {
      // The slots give each lowercase name a value for the checker to read, so
      // E0005 is the only diagnostic — and without it, code generation would
      // inline the tiles of the same names into each other.
      what: "lowercase",
      source: `slot a : Int = 1
slot b : Int = 2
tile a = column(b)
tile b = column(a)
tile App = column(a)
${TAIL}`,
      message: `Tile "a" expands into itself (a → b → a)`,
      at: "3:17",
    },
  ];
  for (const { what, source, message, at } of LOOPS) {
    it(`refuses to build the ${what} loop`, () => {
      const result = compile(source, { runtimeSpecifier: "@kumikijs/runtime", capabilities: [] });
      expect(result.kind).toBe("fail");
      if (result.kind !== "fail") return;
      expect(result.errors.map((e) => [e.code, e.message, `${e.pos.line}:${e.pos.col}`])).toEqual([
        ["E0005", message, at],
      ]);
    });
  }
});
