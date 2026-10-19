import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const program = (home: string) =>
  withApp(
    `tile Card in={label: Text} = text($1.label)
tile Home = ${home}
slot n : Int = 0`,
    "Home",
  );

describe("a value as a child is refused before it can render nothing", () => {
  it.each([
    "column(let x = 42 in Card(x))",
    "column(let x = () in Card(x))",
    `column(let x = {label: "a"} in Card(x))`,
    `column(heading("h"), let x = () in Card(x))`,
    `column(text("a"), 42)`,
    `column(text("a"), "s")`,
    `column(text("a"), n)`,
    `column(text("a"), n.show)`,
  ])("%s", async (home) => {
    expect(check(parse(lex(program(home)))).map((e) => e.code)).toEqual(["E0128"]);
    await expect(loadSource(program(home))).rejects.toThrow("E0128");
  });
});

describe("a value as an arm or a tile body is refused before it is built", () => {
  it.each([
    "column(when(n > 0, n))",
    `column(if n > 0 then Card({label: "a"}) else n)`,
    "column(for x in [1, 2] x)",
    "n",
  ])("%s", async (home) => {
    expect(check(parse(lex(program(home)))).map((e) => e.code)).toEqual(["E0128"]);
    await expect(loadSource(program(home))).rejects.toThrow("E0128");
  });
});

it("a builtin named in an arm renders as its call does", async () => {
  const render = async (home: string) => mountApp(await loadSource(program(home))).root.innerHTML;
  const named = await render("column(when(n == 0, divider))");
  expect(named).toContain('data-kumiki-tile="divider"');
  expect(named).toBe(await render("column(when(n == 0, divider()))"));
});

describe("a value where a value belongs mounts and shows the value", () => {
  it.each([
    [`column(text(let x = "shown" in x))`, "shown"],
    [`column(Card(let x = "shown" in {label: x}))`, "shown"],
    [`column(button(text=let b = "shown" in b))`, "shown"],
  ])("%s", async (home, says) => {
    const { root } = mountApp(await loadSource(program(home)));
    expect(root.textContent).toBe(says);
  });
});
