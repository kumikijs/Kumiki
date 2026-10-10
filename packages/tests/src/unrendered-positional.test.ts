import { BUILTIN_TILES, check, lex, parse, VALUE_ARG_BUILTINS } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const program = (home: string) =>
  withApp(
    `tile Header = text("header")
tile Home = ${home}`,
    "Home",
  );

/** The text the mounted app shows, overlays included (a modal mounts outside its parent). */
async function shown(home: string): Promise<string> {
  document.body.innerHTML = "";
  mountApp(await loadSource(program(home)));
  return document.body.textContent ?? "";
}

it("a dropped tile on a builtin that renders none is refused at check time", async () => {
  const home = `column(button(Header, text="Go"), progress(text("a")), text("end"))`;
  expect(check(parse(lex(program(home)))).map((e) => e.code)).toEqual(["E0129", "E0129"]);
  await expect(loadSource(program(home))).rejects.toThrow("E0129");
});

/** The codes `check` refuses the tile `Header` in `home` with, or else whether the app shows it. */
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
