// `check` and the mounted app agree on a tile written as a value builtin's
// content. The lowering shows the content as a value, so the tile itself
// never reaches the page; `check` refuses it (E0236) before anything is
// built. A value `if` / `match` there is a value, and shows the arm taken.
// The checker's cases are in `packages/compiler/test/tile-as-content.test.ts`.

import { check, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.js";

const program = (home: string) => `tile Header = text("header")
tile Home = ${home}
type Shape = Circle | Square
slot shape : Shape = Circle
slot c : Bool = true
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

it("the issue's program is refused at check time, at the when", async () => {
  const src = `tile App = column(text(when(true, column(text("inner")))))
app M
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
  expect(check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`)).toEqual([
    "E0236 1:24",
  ]);
  await expect(loadSource(src)).rejects.toThrow("E0236");
});

/** The text the mounted app shows. */
async function shown(home: string): Promise<string> {
  document.body.innerHTML = "";
  const target = document.createElement("div");
  document.body.appendChild(target);
  mount(await loadSource(program(home)), target);
  return document.body.textContent ?? "";
}

/**
 * What becomes of the tile `Header` written in `home`: the codes `check`
 * refuses it with, or else whether the mounted app shows it.
 */
async function outcome(home: string): Promise<string> {
  const codes = check(parse(lex(program(home)))).map((e) => e.code);
  if (codes.length > 0) return codes.join(",");
  return (await shown(home)).includes("header") ? "shown" : "dropped";
}

describe("a tile as a value builtin's content is refused at check time", () => {
  it.each([
    ["a when", `column(text(when(c, Header)), text("end"))`, "E0236"],
    ["a for", `column(heading(for x in [1] Header), text("end"))`, "E0236"],
    ["a builtin's call", `column(markdown(column(Header)), text("end"))`, "E0236"],
    ["a tile's name", `column(label(Header), text("end"))`, "E0236"],
    ["the tile arms of an if", `column(code(if c then Header else Header))`, "E0236,E0236"],
    [
      "the tile arms of a match",
      `column(link(match shape with | Circle -> Header | Square -> Header, to="/"))`,
      "E0236,E0236",
    ],
  ])("%s", async (_, home, refused) => {
    expect(await outcome(home)).toBe(refused);
  });
});

describe("a value if / match as the content shows the arm taken", () => {
  it.each([
    [`column(text(match shape with | Circle -> "round" | Square -> "square"))`, "round"],
    [`column(text(if c then "yes" else "no"))`, "yes"],
  ])("%s", async (home, says) => {
    expect(await shown(home)).toBe(says);
  });
});
