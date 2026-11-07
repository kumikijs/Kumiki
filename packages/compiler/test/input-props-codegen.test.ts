import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";
import { compileOrFail } from "./helpers/module.ts";
import { withRoot } from "./helpers/programs.ts";

/** The fields a `<kind>` tile node carries ahead of its props, as the compiled module writes them. */
function fieldsOf(js: string, kind: string): string {
  const at = js.indexOf(`kind: "${kind}", `);
  if (at < 0) expect.fail(`no ${kind} node in the compiled module`);
  const rest = js.slice(at + `kind: "${kind}", `.length);
  return rest.slice(0, rest.indexOf(", props: "));
}

describe("a radio's group and a slider's value reach the node", () => {
  it.each([
    [`radio(name="g", value="a")`, `group: "g", value: "a"`],
    [`radio(group="g", name="n", value="a")`, `group: "g", value: "a"`],
    [`radio(value="a") {group: "g"}`, `group: "g", value: "a"`],
    [`radio(value="a") {name: "g"}`, `group: "g", value: "a"`],
  ])("%s emits %s", (tile, fields) => {
    expect(fieldsOf(compileOrFail(withRoot(tile, "")), "radio")).toBe(fields);
  });

  it.each([
    ["slider(value=7, min=0, max=10)", "min: 0, max: 10, value: 7"],
    ["slider(min=0, max=10) {value: 7}", "min: 0, max: 10, value: 7"],
    ["slider(bind=v, value=7, min=0, max=10)", `min: 0, max: 10, bind: "v", value: _live["v"]`],
  ])("%s emits %s", (tile, fields) => {
    expect(fieldsOf(compileOrFail(withRoot(tile, "slot v : Int = 3")), "slider")).toBe(fields);
  });
});

describe("a second spelling of one value is reported, as it is not read", () => {
  const warned = (tile: string) =>
    checkSource(withRoot(tile, "slot v : Int = 3"))
      .filter((d) => d.code === "W0216" || d.code === "W0217")
      .map((d) => [d.code, d.kind, d.severity, d.message]);

  it.each([
    [`radio(group="g", name="n", value="a")`],
    [`radio(group="g", value="a") {name: "n"}`],
    [`radio(value="a") {group: "g", name: "n"}`],
  ])("warns W0217 on the name beside a group in %s", (tile) => {
    expect(warned(tile)).toEqual([
      [
        "W0217",
        "name-beside-group",
        "warning",
        expect.stringContaining(
          `"name" on radio() is not read beside group= — group= names the set the radio is in. Remove one`,
        ),
      ],
    ]);
  });

  it.each([
    ["slider(bind=v, value=7, min=0, max=10)"],
    ["slider(bind=v, min=0, max=10) {value: 7}"],
  ])("warns W0216 on the value beside a bind in %s", (tile) => {
    expect(warned(tile)).toEqual([
      [
        "W0216",
        "selection-beside-bind",
        "warning",
        expect.stringContaining(
          `"value" on slider() is not read beside bind= — the bound value is what it shows. Remove it`,
        ),
      ],
    ]);
  });

  it.each([
    [`radio(name="g", value="a")`],
    [`radio(group="g", value="a")`],
    ["slider(value=7, min=0, max=10)"],
    ["slider(bind=v, min=0, max=10)"],
  ])("says nothing about %s", (tile) => {
    expect(warned(tile)).toEqual([]);
  });
});
