// `check` and the mounted app agree on a builtin's positional argument.
//
// A container renders its positional tiles as children. Every other builtin
// that is not a value builtin renders no positional argument, tile or value,
// and `check` refuses one there (E0129) before anything is built. So for each
// builtin a positional tile is either refused or on the page — never accepted
// and missing. The checker's cases are in
// `packages/compiler/test/unrendered-positional.test.ts`.

import { BUILTIN_TILES, check, lex, parse, VALUE_ARG_BUILTINS } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.js";

const program = (home: string) => `tile Header = text("header")
tile Home = ${home}
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

/** The text the mounted app shows, overlays included (a modal mounts outside its parent). */
async function shown(home: string): Promise<string> {
  document.body.innerHTML = "";
  const target = document.createElement("div");
  document.body.appendChild(target);
  mount(await loadSource(program(home)), target);
  return document.body.textContent ?? "";
}

it("the issue's program is refused at check time, at each dropped tile", async () => {
  const home = `column(button(Header, text="Go"), progress(text("a")), text("end"))`;
  expect(check(parse(lex(program(home)))).map((e) => e.code)).toEqual(["E0129", "E0129"]);
  await expect(loadSource(program(home))).rejects.toThrow("E0129");
});

/**
 * What becomes of the tile `Header` written in `home`: the codes `check`
 * refuses it with, or else whether the mounted app shows it.
 */
async function outcome(home: string): Promise<string> {
  const codes = check(parse(lex(program(home)))).map((e) => e.code);
  if (codes.length > 0) return codes.join(",");
  return (await shown(home)).includes("header") ? "shown" : "dropped";
}

describe("a positional tile is refused or rendered", () => {
  const notValueBuiltins = [...BUILTIN_TILES].filter((name) => !VALUE_ARG_BUILTINS.has(name));
  it.each(notValueBuiltins)("%s", async (builtin) => {
    expect(["E0129", "shown"]).toContain(await outcome(`column(${builtin}(Header), text("end"))`));
  });
});

describe("a container shows its positional tile", () => {
  it.each([
    "column(Header)",
    "card(Header)",
    `tooltip(Header, text="tip")`,
    "popover(Header)",
  ])("%s", async (home) => {
    expect(await shown(home)).toContain("header");
  });

  it("a button shows its text=", async () => {
    expect(await shown(`column(button(text="Go"))`)).toBe("Go");
  });
});
