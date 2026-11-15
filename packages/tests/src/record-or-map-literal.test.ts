import { readFileSync } from "node:fs";
import { testFile } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadSource, writeSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const EXAMPLE = feature("172-map-literal-bool-keys");

async function render(defs: string, shown: string, clicks = 0): Promise<string> {
  const src = withApp(`${defs}
tile Go = button(text="go") {id: "go"}
tile App = column(Go, text(${shown}))`);
  const steps = [
    ...Array.from({ length: clicks }, () => ({ do: { click: "#go" }, expect: {} })),
    { expect: { noErrors: true } },
  ];
  const report = await runScenario(await loadSource(src), freshRoot(), { steps });
  return report.steps.at(-1)?.domText ?? "";
}

describe("a Map literal whose first key is a value keyword", () => {
  it("initialises a Map(Bool, Text) slot", async () => {
    const text = await render(
      'slot labels : Map(Bool, Text) = {true: "on", false: "off"}',
      '"r=" + labels.get-or(true, "?") + "/" + labels.get-or(false, "?") + ";"',
    );
    expect(text).toContain("r=on/off;");
  });

  it("is written to a Map(Bool, Text) slot by a reducer", async () => {
    const text = await render(
      `slot labels : Map(Bool, Text) = {}
reducer fill on=ui.click(Go) do= labels := {false: "off", true: "on"}`,
      '"r=" + labels.get-or(true, "?") + "/" + labels.get-or(false, "?") + ";"',
      1,
    );
    expect(text).toContain("r=on/off;");
  });

  it("keys a Map(Time, Text) by `now`", async () => {
    const text = await render(
      `slot stamps : Map(Time, Text) = {}
reducer fill on=ui.click(Go) do= stamps := {now: "start"}`,
      '"r=" + stamps.size.show + " " + stamps.values.fold("", $1 + $2) + ";"',
      1,
    );
    expect(text).toContain("r=1 start;");
  });
});

describe("the example", () => {
  it("passes its reducer-test, a Bool-keyed Map beside a record led by `type`", {
    timeout: 30_000,
  }, async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => `${r.name}:${r.pass}`)).toEqual(["rename-writes-bool-keys:true"]);
  });

  // A runner that passed every Bool-keyed Map would pass the swapped expectation too.
  it("fails its reducer-test when the expected Map swaps the values", {
    timeout: 30_000,
  }, async () => {
    const asWritten = 'expect = {slots: {labels: {true: "yes", false: "no"}}}';
    const source = readFileSync(EXAMPLE, "utf8");
    if (!source.includes(asWritten)) throw new Error(`the example has no ${asWritten}`);
    const file = writeSource(
      "bool-map-keys-swapped",
      source.replace(asWritten, 'expect = {slots: {labels: {true: "no", false: "yes"}}}'),
    );
    const results = await testFile(file);
    expect(results.map((r) => `${r.name}:${r.pass} @${r.diffAt}`)).toEqual([
      "rename-writes-bool-keys:false @slots.labels",
    ]);
    expect(results[0]?.leaf).toEqual({
      expected: { true: "no", false: "yes" },
      actual: { true: "yes", false: "no" },
    });
  });
});
