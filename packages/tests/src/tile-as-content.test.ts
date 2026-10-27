import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const program = (home: string) =>
  withApp(
    `tile Header = text("header")
tile Home = ${home}
type Shape = Circle | Square
slot shape : Shape = Circle
slot c : Bool = true`,
    "Home",
  );

it("a when as text's content is refused at check time, at the when", async () => {
  const src = withApp(`tile App = column(text(when(true, column(text("inner")))))`);
  expect(check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`)).toEqual([
    "E0236 1:24",
  ]);
  await expect(loadSource(src)).rejects.toThrow("E0236");
});

async function shown(home: string): Promise<string> {
  document.body.innerHTML = "";
  mountApp(await loadSource(program(home)));
  return document.body.textContent ?? "";
}

/** The codes `check` refuses the tile `Header` in `home` with, or else whether the app shows it. */
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
