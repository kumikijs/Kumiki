// `runFixFromTest`'s tier-1 pass repairs compile errors so the named test can
// run. It composed the same plan `applyFixPlan` does and wrote it straight to
// disk, so the one contract that path guarantees — "apply ⇒ the file is either
// strictly cleaner or unchanged" — did not hold here: a repair that introduced
// an error landed, and the error it created was reported to the author as
// their own.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixCmd, fixFromTest, runFixFromTest } from "@kumikijs/cli";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    const file = fixture("kumiki-tier1-gate-", REPAIR_INTRODUCES_AN_ERROR);
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
      expect(outcome.compileErrors.map((e) => e.code)).toEqual(["E0103"]);
    }
    // A refusal wrote nothing, so it reports no count at all — a planned count
    // here would say a repair happened.
    expect(outcome).not.toHaveProperty("compileFixes");
  });

  it("prints the refusal in the same words `fix --apply` prints", async () => {
    // Sharing `rollbackLine` is the point: a repair one verb declines and the
    // other accepts is the disagreement this file exists to prevent. Compared
    // between the two verbs rather than against a literal, so the assertion
    // holds whatever the sentence is reworded to.
    const file = fixture("kumiki-tier1-print-", REPAIR_INTRODUCES_AN_ERROR);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rolled = /^\(auto-patch rolled back/;
      fixCmd(file, true);
      const fromFix = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => rolled.test(l));
      logSpy.mockClear();

      await fixFromTest(file, "bumps", true);
      const said = logSpy.mock.calls.map((c) => String(c[0]));

      expect(said.filter((l) => rolled.test(l))).toEqual(fromFix);
      expect(fromFix).toHaveLength(1);
      expect(fromFix[0]).toContain("E0201@");
      // Never the header that says a repair landed.
      expect(said.some((l) => l.startsWith("applied "))).toBe(false);
      expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("E0103");
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("still reports the planned count in a dry run, which is what it proposes", async () => {
    const file = fixture("kumiki-tier1-dry-", REPAIR_INTRODUCES_AN_ERROR);
    const before = readFileSync(file, "utf8");

    const outcome = await runFixFromTest(file, "bumps", false);

    expect(outcome.status).toBe("compile-proposed");
    if (outcome.status === "compile-proposed") expect(outcome.compileFixes).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("still reaches compile-remaining when the gate passes and errors are left", async () => {
    // Two errors, one repairable: the `$route` read has a deterministic
    // rewrite, the undeclared name in the second reducer resolves to nothing
    // close enough to suggest. The write is a real repair, so it lands — and
    // the file still cannot run its test.
    const file = fixture("kumiki-tier1-remaining-", [
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
  });
});
