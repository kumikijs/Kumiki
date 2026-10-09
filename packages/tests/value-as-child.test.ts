// `check` and the mounted app agree on a value written where a tile belongs.
//
// A value as a positional argument of a builtin that is not a value builtin
// used to pass `check` and then render nothing: codegen dropped it, so
// `column(let x = 42 in Card(x))` mounted an empty root,
// `column(heading("h"), let x = () in Card(x))` showed only the heading, and
// `column(text("a"), 42)` showed only the `text`. Each of those programs is
// now refused before anything is built (E0128). A value where a value belongs
// — a text builtin's content, a user tile's input, a named argument — still
// mounts and shows its value. The checker's cases are in
// `packages/compiler/test/value-as-child.test.ts`.

import { check, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.js";

const program = (home: string) => `tile Card in={label: Text} = text($1.label)
tile Home = ${home}
slot n : Int = 0
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

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

describe("the name of a tile as a child mounts the tile", () => {
  it.each([
    ["with no other definition of the name", ""],
    ["beside a fn of the same name", `fn leaf() -> Text = "fn"\n`],
  ])("%s", async (_, extra) => {
    const app = await loadSource(`${extra}tile leaf = text("tile")\n${program("column(leaf)")}`);
    const target = document.createElement("div");
    document.body.appendChild(target);
    mount(app, target);
    expect(target.textContent).toBe("tile");
  });
});

describe("a value where a value belongs mounts and shows the value", () => {
  it.each([
    [`column(text(let x = "shown" in x))`, "shown"],
    [`column(Card(let x = "shown" in {label: x}))`, "shown"],
    [`column(button(text=let b = "shown" in b))`, "shown"],
  ])("%s", async (home, says) => {
    const app = await loadSource(program(home));
    const target = document.createElement("div");
    document.body.appendChild(target);
    mount(app, target);
    expect(target.textContent).toBe(says);
  });
});
