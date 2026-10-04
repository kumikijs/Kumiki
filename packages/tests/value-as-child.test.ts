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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.js";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "221-container-child-value.kumiki");

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

// Example 221 shows a slot, a Text literal, a `fn` call and a member read in a
// container, each through the `text(…)` written around it, and its scenario
// reads them off the page. The same source with each `text(…)` taken off is
// E0128 at every value, naming the container it sits in and `text(…)` as the
// fix, and nothing is built.
describe("example 221's values, written bare, are each refused", () => {
  const bare: [string, string][] = [
    ["  text(total.show),", "  total,"],
    [`  text("Total items"),`, `  "Total items",`],
    ["  text(greeting()),", "  greeting(),"],
    [`  row(text("Sum: "), text(total.show)),`, `  row(text("Sum: "), total.show),`],
  ];
  const shown = readFileSync(EXAMPLE, "utf8").split("\n");
  const lines = shown.map((l) => bare.find(([from]) => from === l)?.[1] ?? l);
  const source = lines.join("\n");
  // Where `value` starts on the source line `line`, as a diagnostic gives it.
  const at = (line: string, value: string) =>
    `${lines.indexOf(line) + 1}:${line.indexOf(value) + 1}`;

  it("takes each text(…) off one line of the example", () => {
    for (const [from] of bare) expect(shown.filter((l) => l === from)).toHaveLength(1);
  });

  it("is E0128 at each value, naming its container and text(…)", () => {
    const diagnostics = check(parse(lex(source)));
    expect(diagnostics.map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`)).toEqual([
      `E0128 ${at("  total,", "total")}`,
      `E0128 ${at(`  "Total items",`, `"Total`)}`,
      `E0128 ${at("  greeting(),", "greeting")}`,
      `E0128 ${at(`  row(text("Sum: "), total.show),`, "total.show")}`,
    ]);
    expect(diagnostics.map((e) => e.message.split(" renders ")[0])).toEqual([
      "A value is not a tile: column",
      "A value is not a tile: column",
      "A value is not a tile: column",
      "A value is not a tile: row",
    ]);
    for (const e of diagnostics) expect(e.message).toContain("`text(…)`");
  });

  it("is not built", async () => {
    await expect(loadSource(source)).rejects.toThrow("E0128");
  });
});
