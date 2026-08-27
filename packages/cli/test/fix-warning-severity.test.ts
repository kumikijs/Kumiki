// A warning is advisory: `check` reports one and exits 0, and no repair branch
// emits a patch for a warning code. `fix` decided what to do about a file
// without asking about severity, so a file whose only diagnostic was `W0212`
// looked to it exactly like a file full of errors.
//
// The fix-from-test path gates its behavioural tier on "does this file
// compile", so an unrelated warning anywhere in the file stopped
// `kumiki fix --auto-patch` repairing a failing test at all — and its second
// gate did the same one step later, reporting a warning a successful repair
// had revealed as what remained.
//
// The counterpart is that a warning must stay visible. `fix` reporting a bare
// "no errors" for a file `check` calls "ok (1 warning)" trades one wrong answer
// for another, so every verdict this file's subject reaches carries the
// advisory diagnostics it decided not to act on.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KumikiError } from "@kumikijs/compiler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyFixPlan, fixCmd, planFix, runFixFromTest } from "../src/fix.ts";

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
    expect(outcome.status).toBe("no-patch");
    if (outcome.status !== "no-patch") return;
    // Exactly the errors: `toContain("E0105")` would pass just as well on the
    // unfiltered list, so it would not notice the filter going away.
    expect((outcome.compileErrors ?? []).map((e: KumikiError) => e.code)).toEqual(["E0105"]);
  });

  it("reports what is left after a repair, without the warning among it", async () => {
    // The second gate's own test. One repairable error, one that is not, and a
    // warning: tier 1 lands the repair it has, and what remains has to be the
    // error it could not fix — not the advisory diagnostic beside it.
    write([
      'slot f : Text = ""',
      'reducer recordFocus on=ui.focus(Crd) do= f := "focused"',
      'tile Card = box(text("hi"))',
      'tile Title = heading("Helo")',
      "tile App = column(Card, Title, Missing)",
      ...APP,
      ...FAILING_TEST,
    ]);
    const outcome = await runFixFromTest(file, "t", true);
    expect(outcome.status).toBe("compile-remaining");
    if (outcome.status !== "compile-remaining") return;
    expect(outcome.compileFixes).toBeGreaterThanOrEqual(1);
    expect((outcome.compileErrors ?? []).map((e: KumikiError) => e.code)).toEqual(["E0105"]);
    expect(outcome.warnings.map((w) => w.code)).toEqual(["W0212"]);
  });
});

describe("what the results say about the warnings they filtered out", () => {
  it("carries them beside the errors", () => {
    // Beside the errors, literally: a file that has both. The clean-file case
    // below only reaches the early return, so on its own it would leave the
    // error branch free to drop them.
    write([...WARNING, "tile App = column(Card, Missing)", ...APP]);
    const plan = planFix(file, undefined, []);
    expect(plan.errors.map((e) => e.code)).toEqual(["E0105"]);
    expect(plan.warnings.map((w) => w.code)).toEqual(["W0212"]);
  });

  it("carries them out of the apply path, from the state it left the file in", () => {
    // The repair resolves `Crd` to `Card`, and a `box` cannot fire `focus`, so
    // the warning is one the repair *revealed*. Reporting the pre-patch set
    // here would name the wrong diagnostics for the file now on disk.
    write([
      'slot f : Text = ""',
      'reducer recordFocus on=ui.focus(Crd) do= f := "focused"',
      'tile Card = box(text("hi"))',
      "tile App = column(Card)",
      ...APP,
    ]);
    const result = applyFixPlan(file, undefined, []);
    expect(result.applied).toBe(1);
    expect(result.remaining).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(["W0212"]);
  });
});

/** Everything `fix` prints when it decides a file needs nothing from it. */
describe("the verdicts fix prints", () => {
  const printed = (run: () => number): { code: number; out: string; err: string } => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const code = run();
      const join = (spy: typeof log) => spy.mock.calls.map((c) => String(c[0])).join("\n");
      return { code, out: join(log), err: join(err) };
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  };

  it("says the file is clean and still says what is in it", () => {
    // `check` calls this file "ok (1 warning)". `fix` saying "no errors" and
    // nothing else is the same lie as the one this suite removes, told the
    // other way round.
    write([...WARNING, "tile App = column(Card)", ...APP]);
    const dry = printed(() => fixCmd(file, false));
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("no errors (1 warning)");
    expect(dry.err).toContain("W0212");
  });

  it("says it the same way with --apply, which changes the file just as little", () => {
    write([...WARNING, "tile App = column(Card)", ...APP]);
    const applied = printed(() => fixCmd(file, true));
    expect(applied.code).toBe(0);
    expect(applied.out).toContain("no errors (1 warning)");
    expect(applied.err).toContain("W0212");
  });

  it("counts more than one", () => {
    write([
      'slot f : Text = ""',
      'slot g : Text = ""',
      'reducer recordFocus on=ui.focus(Card) do= f := "focused"',
      'reducer recordBlur on=ui.blur(Other) do= g := "blurred"',
      'tile Card = box(text("hi"))',
      'tile Other = box(text("there"))',
      "tile App = column(Card, Other)",
      ...APP,
    ]);
    expect(printed(() => fixCmd(file, false)).out).toContain("no errors (2 warnings)");
  });

  it("lists them under the errors when the file has both", () => {
    // `check` reports both. `fix` reporting only the error is the same two
    // answers about one file, in the branch nobody was looking at.
    write([...WARNING, "tile App = column(Card, Missing)", ...APP]);
    const dry = printed(() => fixCmd(file, false));
    expect(dry.code).toBe(1);
    expect(dry.err).toContain("E0105");
    expect(dry.err).toContain("W0212");
  });

  it("says plain `no errors` when there is nothing at all", () => {
    write(['tile App = column(text("hi"))', ...APP]);
    const dry = printed(() => fixCmd(file, false));
    expect(dry.code).toBe(0);
    expect(dry.out).toBe("no errors");
    expect(dry.err).toBe("");
  });
});
