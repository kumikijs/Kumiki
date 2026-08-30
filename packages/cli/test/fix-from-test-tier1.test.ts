// `runFixFromTest`'s tier-1 pass repairs compile errors so the named test can
// run. It composed the same plan `applyFixPlan` does and wrote it straight to
// disk, so the one contract that path guarantees — "apply ⇒ the file is either
// strictly cleaner or unchanged" — did not hold here: a repair that introduced
// an error landed, and the error it created was reported to the author as
// their own.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFixFromTest } from "@kumikijs/cli";
import { describe, expect, it } from "vitest";

/** A file in its own temp directory, and the cleanup for it. */
function fixture(prefix: string, lines: string[]): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const file = join(dir, "in.kumiki");
  writeFileSync(file, `${lines.join("\n")}\n`);
  return { dir, file };
}

/**
 * A close-name suggestion that repairs the error it was offered for and
 * introduces a type error in its place: `cnt` is undefined, `cn` is the
 * nearest declared name, and `cn` is a `Text` in an `Int` sum.
 */
const REPAIR_INTRODUCES_AN_ERROR = [
  "slot n  : Int  = 0",
  'slot cn : Text = ""',
  "reducer bump on=ui.click(Btn) do= n := cnt + 1",
  'tile Btn  = button(text="go")',
  "tile Page = column(Btn, text(n))",
  "test bumps =",
  "    reducer-test bump",
  "        given  = {slots: {n: 0}, event: {type: ui.click, target: Btn}}",
  "        expect = {slots: {n: 9}}",
  "app A",
  "    caps   = []",
  '    routes = {"/" -> Page, "/404" -> Page}',
  "    init   = []",
];

describe("tier-1 repair is gated the way every other write is", () => {
  it("rolls back a repair that introduces an error, and leaves the file alone", async () => {
    const { dir, file } = fixture("kumiki-tier1-gate-", REPAIR_INTRODUCES_AN_ERROR);
    const before = readFileSync(file, "utf8");

    const outcome = await runFixFromTest(file, "bumps", true);

    expect(readFileSync(file, "utf8")).toBe(before);
    expect(outcome.status).toBe("compile-blocked");
    // Distinguishable from "no patch available": one was found, and refused.
    if (outcome.status === "compile-blocked") {
      expect(outcome.blocked.reason).toBe("introduced");
      if (outcome.blocked.reason === "introduced") {
        expect(outcome.blocked.introduced.map((e) => e.code)).toEqual(["E0201"]);
      }
      // The errors reported are the author's own, not the ones the repair made.
      expect(outcome.compileErrors?.map((e) => e.code)).toEqual(["E0103"]);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts what landed, not what was planned", async () => {
    // One patch was planned and none landed. A count taken from the plan
    // reports the rollback as a repair.
    const { dir, file } = fixture("kumiki-tier1-count-", REPAIR_INTRODUCES_AN_ERROR);
    const outcome = await runFixFromTest(file, "bumps", true);
    expect(outcome).not.toHaveProperty("compileFixes", 1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("still reports the planned count in a dry run, which is what it proposes", async () => {
    const { dir, file } = fixture("kumiki-tier1-dry-", REPAIR_INTRODUCES_AN_ERROR);
    const before = readFileSync(file, "utf8");

    const outcome = await runFixFromTest(file, "bumps", false);

    expect(outcome.status).toBe("compile-proposed");
    if (outcome.status === "compile-proposed") expect(outcome.compileFixes).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(before);
    rmSync(dir, { recursive: true, force: true });
  });

  it("still reaches compile-remaining when the gate passes and errors are left", async () => {
    // Two errors, one repairable: the `$route` read has a deterministic
    // rewrite, the undeclared tile in the second reducer's selector does not
    // resolve to any declared name. The write is a real repair, so it lands —
    // and the file still cannot run its test.
    const { dir, file } = fixture("kumiki-tier1-remaining-", [
      'slot seen : Text = ""',
      "reducer clicked on=ui.click(B) do= seen := $route.path",
      "reducer other   on=ui.click(B) do= seen := nowhere",
      'tile B = button(text="go")',
      "tile App = column(B, text(seen))",
      "test t =",
      "    reducer-test clicked",
      '        given  = {slots: {seen: ""}, event: {type: ui.click, target: B}}',
      '        expect = {slots: {seen: "/x"}}',
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init   = []",
    ]);

    const outcome = await runFixFromTest(file, "t", true);

    expect(outcome.status).toBe("compile-remaining");
    if (outcome.status === "compile-remaining") {
      expect(outcome.compileFixes).toBe(1);
      expect(outcome.compileErrors?.map((e) => e.code)).toEqual(["E0103"]);
    }
    expect(readFileSync(file, "utf8")).toContain("seen := route.path");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("a warning is not a compile error", () => {
  it("lets a file whose only diagnostic is a warning reach the behavioural tier", async () => {
    // Pinned rather than fixed: `repairable` already keeps warnings out of the
    // tier-1 gate. The file below carries a W0212 and nothing else, and the
    // outcome is a tier-2 proposal that names the warning alongside it.
    const { dir, file } = fixture("kumiki-tier1-warning-", [
      "slot n : Int = 0",
      "reducer bump on=ui.focus(Card) do= n := n + 1",
      'tile Card = box(text("x"))',
      "tile Page = column(Card, text(n))",
      "test bumps =",
      "    reducer-test bump",
      "        given  = {slots: {n: 0}, event: {type: ui.focus, target: Card}}",
      "        expect = {slots: {n: 9}}",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> Page, "/404" -> Page}',
      "    init   = []",
    ]);

    const outcome = await runFixFromTest(file, "bumps", false);

    expect(outcome.status).toBe("proposed");
    expect(outcome.warnings.map((w) => w.code)).toEqual(["W0212"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
