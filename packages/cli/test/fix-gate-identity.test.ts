// What the regression gate reads a diagnostic as.
//
// It compared `code@line:col`, so a repair that changed a fragment's length
// moved every diagnostic to its right — and `E0001`'s repair, which prepends a
// tile, moved every diagnostic below it. A moved diagnostic is not in the
// before-set, so the gate called it introduced and rolled the whole plan back
// over a diagnostic no patch had touched.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFixPlan } from "@kumikijs/cli";
import { afterEach, describe, expect, it } from "vitest";

let dir = "";
const fixture = (prefix: string, lines: string[]): string => {
  dir = mkdtempSync(join(tmpdir(), prefix));
  const file = join(dir, "in.kumiki");
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
};
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

const at = (e: { code: string; pos: { line: number; col: number } }): string =>
  `${e.code}@${e.pos.line}:${e.pos.col}`;

describe("a diagnostic a repair merely moved is not an introduced one", () => {
  it("along its line — the repair is shorter than what it replaced", () => {
    // `$route` → `route` is repairable and one character shorter, so the
    // unrepairable `qqqqqqqqqq` beside it lands one column to the left.
    const file = fixture("kumiki-gate-column-", [
      'slot seen : Text = ""',
      "reducer clicked on=ui.click(B) do= seen := $route.path + qqqqqqqqqq",
      'tile B = button(text="go")',
      "tile App = column(B)",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init   = []",
    ]);

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(1);
    expect(result.regressionBlocked).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain("seen := route.path + qqqqqqqqqq");
    // Still there, at the position it moved to — reported, not repaired.
    expect(result.remaining.map(at)).toEqual(["E0103@2:57"]);
  });

  it("down the file — the repair inserts lines above it", () => {
    // `E0001` prepends a `tile NotFound` block, so every diagnostic below it
    // moves two lines down. This is the commonest repair in the catalogue, and
    // one unrepairable name anywhere under it used to block the whole plan.
    const file = fixture("kumiki-gate-row-", [
      'slot seen : Text = ""',
      'reducer clicked on=ui.click(B) do= seen := "x"',
      'tile B = button(text="go")',
      "tile App = column(B, text(nowhere))",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App}',
      "    init   = []",
    ]);

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(1);
    expect(result.regressionBlocked).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain('"/404" -> NotFound');
    expect(result.remaining.map(at)).toEqual(["E0103@6:27"]);
  });

  it("when two diagnostics share a code and only one is repairable", () => {
    // Both are E0103, so a comparison keyed on the code alone cannot tell
    // "repaired counter" from "repaired counter, broke something else".
    const file = fixture("kumiki-gate-samecode-", [
      "slot counter : Int = 0",
      "slot n : Int = 0",
      "reducer r on=ui.click(B) do= n := countr + qqqqqqqqqq",
      'tile B = button(text="go")',
      "tile App = column(B, text(n))",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init   = []",
    ]);

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(1);
    expect(readFileSync(file, "utf8")).toContain("n := counter + qqqqqqqqqq");
    expect(result.remaining.map((e) => e.code)).toEqual(["E0103"]);
    expect(result.remaining[0]?.message).toContain("qqqqqqqqqq");
  });
});

describe("a repair that leaves the file no cleaner still rolls back", () => {
  it("when it swaps one diagnostic for another", () => {
    // `cap=lgo` is E0301; adding `lgo` to app.caps clears it and immediately
    // raises E0302 unknown-capability. The count is 1 either way — the thing
    // the comparison exists to catch, and dropping position must not lose it.
    const file = fixture("kumiki-gate-swap-", [
      "effect logHello cap=lgo",
      "                in=Text",
      "                out=Unit",
      "",
      'reducer greet on=app.start do= emit logHello("hi")',
      'tile App = heading("hi")',
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init   = []",
    ]);
    const before = readFileSync(file, "utf8");

    const result = applyFixPlan(file, "E0301");

    expect(result.applied).toBe(0);
    expect(result.regressionBlocked).toBe(true);
    expect(result.blocked?.reason).toBe("introduced");
    if (result.blocked?.reason === "introduced") {
      expect(result.blocked.introduced.map((e) => e.code)).toEqual(["E0302"]);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("when the repair creates a type error where a name error was", () => {
    // `cnt` resolves to the nearest declared name `cn`, which is a `Text` in
    // an `Int` sum. Same position, different code and message.
    const file = fixture("kumiki-gate-introduced-", [
      "slot n  : Int  = 0",
      'slot cn : Text = ""',
      "reducer bump on=ui.click(Btn) do= n := cnt + 1",
      'tile Btn  = button(text="go")',
      "tile Page = column(Btn, text(n))",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> Page, "/404" -> Page}',
      "    init   = []",
    ]);
    const before = readFileSync(file, "utf8");

    const result = applyFixPlan(file, undefined);

    expect(result.applied).toBe(0);
    expect(result.blocked?.reason).toBe("introduced");
    if (result.blocked?.reason === "introduced") {
      expect(result.blocked.introduced.map((e) => e.code)).toEqual(["E0201"]);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
