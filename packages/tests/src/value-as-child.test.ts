import { readFileSync } from "node:fs";
import { check, lex, parse } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
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

describe("the container-child-value example's values, written bare, are each refused", () => {
  const bare: [string, string][] = [
    ["  text(total.show),", "  total,"],
    [`  text("Total items"),`, `  "Total items",`],
    ["  text(greeting()),", "  greeting(),"],
    [`  row(text("Sum: "), text(total.show)),`, `  row(text("Sum: "), total.show),`],
  ];
  const shown = readFileSync(feature("221-container-child-value"), "utf8").split("\n");
  const lines = shown.map((l) => bare.find(([from]) => from === l)?.[1] ?? l);
  const source = lines.join("\n");
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
