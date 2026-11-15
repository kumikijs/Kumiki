import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const program = (home: string, more = "") =>
  withApp(
    `tile Header = text("header")
tile Home = ${home}
type Shape = Circle | Square
slot shape : Shape = Circle
slot c : Bool = true
${more}`,
    "Home",
  );

it("a when as text's content is refused by the compile an app is loaded through", async () => {
  await expect(
    loadSource(withApp(`tile App = column(text(when(true, column(text("inner")))))`)),
  ).rejects.toThrow("E0236");
});

async function shown(home: string, more?: string): Promise<string> {
  document.body.innerHTML = "";
  mountApp(await loadSource(program(home, more)));
  return document.body.textContent ?? "";
}

/** The codes `check` refuses the tile `Header` in `home` with, or else whether the app shows it. */
async function outcome(home: string, more?: string): Promise<string> {
  const codes = check(parse(lex(program(home, more)))).map((e) => e.code);
  if (codes.length > 0) return codes.join(",");
  return (await shown(home, more)).includes("header") ? "shown" : "dropped";
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
    ["the body of a let", `column(text(let x = 1 in Header))`, "E0236"],
    ["link's {text: …}", `column(link(to="/") {text: Header})`, "E0236"],
  ])("%s", async (_, home, refused) => {
    expect(await outcome(home)).toBe(refused);
  });
});

describe("the tile written as a container's child, as the fix says, is shown", () => {
  it.each([
    ["a when", `column(when(c, Header))`],
    ["the tile itself", `column(Header)`],
    ["the tile arm of a tile if", `column(if c then Header else text("b"))`],
  ])("%s", async (_, home) => {
    expect(await outcome(home)).toBe("shown");
  });
});

it("a union's tag named like the tile is a value, so the tile is not shown", async () => {
  expect(await outcome(`column(text(Header))`, "type Part = Header | Footer\n")).toBe("dropped");
});

describe("a value if / match as the content shows the arm taken", () => {
  it.each([
    [`column(text(match shape with | Circle -> "round" | Square -> "square"))`, "round"],
    [`column(text(if c then "yes" else "no"))`, "yes"],
  ])("%s", async (home, says) => {
    expect(await shown(home)).toBe(says);
  });
});
