// `check` and the mounted app agree on a `let` written in a tile body.
//
// A `let` child used to pass `check` and then render nothing: codegen dropped
// the child, so `column(let x = 42 in Card(x))` mounted an empty root, and
// `column(heading("h"), let x = () in Card(x))` showed only the heading. Each
// of those programs is now refused before anything is built (E0128), and a
// `let` in a value position — a builtin's content, a user tile's input —
// still mounts and shows its value. The checker's cases are in
// `packages/compiler/test/let-in-tile-child.test.ts`.

import { check, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.js";

const program = (home: string) => `tile Card in={label: Text} = text($1.label)
tile Home = ${home}
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

describe("a let child is refused before it can render nothing", () => {
  it.each([
    "column(let x = 42 in Card(x))",
    "column(let x = () in Card(x))",
    `column(let x = {label: "a"} in Card(x))`,
    `column(heading("h"), let x = () in Card(x))`,
  ])("%s", async (home) => {
    expect(check(parse(lex(program(home)))).map((e) => e.code)).toEqual(["E0128"]);
    await expect(loadSource(program(home))).rejects.toThrow("E0128");
  });
});

describe("a let where a value belongs mounts and shows the value", () => {
  it.each([
    [`column(text(let x = "shown" in x))`, "shown"],
    [`column(Card(let x = "shown" in {label: x}))`, "shown"],
  ])("%s", async (home, says) => {
    const app = await loadSource(program(home));
    const target = document.createElement("div");
    document.body.appendChild(target);
    mount(app, target);
    expect(target.textContent).toBe(says);
  });
});
