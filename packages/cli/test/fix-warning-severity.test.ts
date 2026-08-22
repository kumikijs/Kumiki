// A warning is advisory: `check` reports one and exits 0, and no repair branch
// emits a patch for a warning code. `fix` read the diagnostic list without
// asking about severity, so a file whose only diagnostic was `W0212` looked to
// it exactly like a file full of errors.
//
// Two of the four `check()` calls in `fix.ts` were fixed when the exit codes
// were made to say whether a verb failed. The two in the fix-from-test path
// were not, and that is the damaging half: the behavioural tier is gated on
// "does this file compile", so an unrelated warning anywhere in the file made
// `kumiki fix --auto-patch` stop being able to repair a failing test at all.
//
// The counterpart is that a warning must stay visible. `fix` reporting a bare
// "no errors" for a file `check` calls "ok (1 warning)" trades one wrong answer
// for another, so the plan carries the warnings it filtered out.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixCmd, planFix, runFixFromTest } from "../src/fix.ts";

/** A `box` cannot fire `focus`, so subscribing to one is W0212 and nothing else. */
const WARNING = [
  'slot f : Text = ""',
  'reducer recordFocus on=ui.focus(Card) do= f := "focused"',
  'tile Card = box(text("hi"))',
];

/** A tile-test that fails on one literal — the shape `planTestPatch` can repair. */
const FAILING_TEST = [
  "test t =",
  "    tile-test Title",
  "        given  = {slots: {}}",
  '        expect = heading("Hello")',
];

const APP = [
  "app A",
  "    caps   = []",
  '    routes = {"/" -> App, "/404" -> App}',
  "    init   = []",
];

const REPAIRED_TILE = 'tile Title = heading("Hello")';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-fix-warn-"));
  file = join(dir, "in.kumiki");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (lines: string[]): string => {
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
};

describe("the fix-from-test tiers on a file that only has warnings", () => {
  it("runs the behavioural tier instead of stopping at the compile tier", async () => {
    // Tier 1 is gated on "the file has diagnostics", which counted the warning.
    // The test tier was therefore unreachable on any file carrying one, and the
    // outcome said `no-patch` without ever having run a test.
    write([
      ...WARNING,
      'tile Title = heading("Helo")',
      "tile App = column(Card, Title)",
      ...APP,
      ...FAILING_TEST,
    ]);
    const outcome = await runFixFromTest(file, "t", true);
    expect(outcome.status).toBe("applied");
    expect(readFileSync(file, "utf8")).toContain(REPAIRED_TILE);
  });

  it("runs it after a compile repair, rather than reporting the warning as what remains", async () => {
    // The second gate: after tier 1 writes, the file is re-checked and any
    // diagnostic means "still broken". Here the repair itself reveals the
    // warning — `Crd` resolves to `Card`, and a `box` cannot fire `focus` — so
    // a successful repair reported `compile-remaining` and stopped.
    write([
      'slot f : Text = ""',
      'reducer recordFocus on=ui.focus(Crd) do= f := "focused"',
      'tile Card = box(text("hi"))',
      'tile Title = heading("Helo")',
      "tile App = column(Card, Title)",
      ...APP,
      ...FAILING_TEST,
    ]);
    const outcome = await runFixFromTest(file, "t", true);
    expect(outcome.status).toBe("applied");
    const after = readFileSync(file, "utf8");
    expect(after).toContain("ui.focus(Card)");
    expect(after).toContain(REPAIRED_TILE);
  });

  it("still stops when a real error is what the file has", async () => {
    // The counterpart: nothing here should make the compile tier optional.
    write([
      ...WARNING,
      'tile Title = heading("Helo")',
      "tile App = column(Card, Title, Missing)",
      ...APP,
      ...FAILING_TEST,
    ]);
    const outcome = await runFixFromTest(file, "t", false);
    expect(outcome.status).not.toBe("applied");
    expect((outcome.compileErrors ?? []).map((e) => e.code)).toContain("E0105");
  });
});

describe("what a plan says about the warnings it filtered out", () => {
  it("carries them beside the errors", () => {
    write([...WARNING, "tile App = column(Card)", ...APP]);
    const plan = planFix(file, undefined, []);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.map((w) => w.code)).toEqual(["W0212"]);
  });

  it("reports the file as clean and still says what is in it", () => {
    // `check` calls this file "ok (1 warning)". `fix` saying "no errors" and
    // nothing else is the same lie as the one this suite removes, told the
    // other way round.
    write([...WARNING, "tile App = column(Card)", ...APP]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(fixCmd(file, false)).toBe(0);
      expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("1 warning");
      expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toContain("W0212");
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });

  it("says plain `no errors` when there is nothing at all", () => {
    write(['tile App = column(text("hi"))', ...APP]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(fixCmd(file, false)).toBe(0);
      expect(log.mock.calls.map((c) => String(c[0]))).toEqual(["no errors"]);
    } finally {
      log.mockRestore();
    }
  });
});
