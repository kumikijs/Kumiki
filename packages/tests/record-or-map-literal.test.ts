// `{true: "on", false: "off"}` is a `Map(Bool, Text)` (language.md §1.9):
// `true`, `false` and `now` are values, not record field names, so a literal
// led by one is a Map, in a slot initialiser and in a reducer write alike. It
// is the same Map a parenthesised first key (`{(true): …}`) writes, and
// `{now: …}` is a `Map(Time, V)` the same way.
//
// These render each form and read the entry back off the page; the example
// runs its reducer-test, whose `given` writes a Bool-keyed Map beside a record
// whose first field is the reserved word `type`, as written and with its
// expected values swapped. The parse decision itself is pinned in
// `packages/compiler/test/record-or-map-literal.test.ts`.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFile } from "@kumikijs/cli";
import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "172-map-literal-bool-keys.kumiki");

/** Render `shown` beside `defs`, after `clicks` clicks on Go, and return the page text. */
async function render(defs: string, shown: string, clicks = 0): Promise<string> {
  const src = `${defs}
tile Go = button(text="go") {id: "go"}
tile App = column(Go, text(${shown}))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
  const root = document.createElement("div");
  document.body.appendChild(root);
  const steps = [
    ...Array.from({ length: clicks }, () => ({ do: { click: "#go" }, expect: {} })),
    { expect: { noErrors: true } },
  ];
  const report = await runScenario(await loadSource(src), root, { steps });
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

  // The same test, expecting the values the other way round, has to fail: a
  // runner that passed every Bool-keyed Map would pass it.
  it("fails its reducer-test when the expected Map swaps the values", {
    timeout: 30_000,
  }, async () => {
    const asWritten = 'expect = {slots: {labels: {true: "yes", false: "no"}}}';
    const source = readFileSync(EXAMPLE, "utf8");
    if (!source.includes(asWritten)) throw new Error(`the example has no ${asWritten}`);
    const dir = mkdtempSync(join(tmpdir(), "kumiki-bool-map-keys-"));
    const file = join(dir, "app.kumiki");
    writeFileSync(
      file,
      source.replace(asWritten, 'expect = {slots: {labels: {true: "no", false: "yes"}}}'),
    );
    try {
      const results = await testFile(file);
      expect(results.map((r) => `${r.name}:${r.pass} @${r.diffAt}`)).toEqual([
        "rename-writes-bool-keys:false @slots.labels",
      ]);
      expect(results[0]?.leaf).toEqual({
        expected: { true: "no", false: "yes" },
        actual: { true: "yes", false: "no" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
