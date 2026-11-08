import { readFileSync } from "node:fs";
import type { KumikiError } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { applyFixPlan, fixCmd, fixFromTest, planFix, runFixFromTest } from "../src/fix.ts";
import { printed } from "./helpers/console.ts";
import { seedLines } from "./helpers/files.ts";

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

let file: string;

const write = (lines: string[]): string => {
  file = seedLines(lines);
  return file;
};

describe("the fix-from-test tiers on a file that only has warnings", () => {
  it("runs the behavioural tier instead of stopping at the compile tier", async () => {
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
    expect((outcome.compileErrors ?? []).map((e: KumikiError) => e.code)).toEqual(["E0105"]);
  });

  it("reports what is left after a repair, without the warning among it", async () => {
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
    write([...WARNING, "tile App = column(Card, Missing)", ...APP]);
    const plan = planFix(file, undefined, []);
    expect(plan.errors.map((e) => e.code)).toEqual(["E0105"]);
    expect(plan.warnings.map((w) => w.code)).toEqual(["W0212"]);
  });

  it("carries them out of the apply path, from the state it left the file in", () => {
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
  it("says the file is clean and still says what is in it", async () => {
    write([...WARNING, "tile App = column(Card)", ...APP]);
    const dry = await printed(() => fixCmd(file, false));
    expect(dry.result).toBe(0);
    expect(dry.out).toContain("no errors (1 warning)");
    expect(dry.err).toContain("W0212");
  });

  it("says it the same way with --apply, which changes the file just as little", async () => {
    write([...WARNING, "tile App = column(Card)", ...APP]);
    const applied = await printed(() => fixCmd(file, true));
    expect(applied.result).toBe(0);
    expect(applied.out).toContain("no errors (1 warning)");
    expect(applied.err).toContain("W0212");
  });

  it("counts more than one", async () => {
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
    expect((await printed(() => fixCmd(file, false))).out).toContain("no errors (2 warnings)");
  });

  it("lists them under the errors when the file has both", async () => {
    write([...WARNING, "tile App = column(Card, Missing)", ...APP]);
    const dry = await printed(() => fixCmd(file, false));
    expect(dry.result).toBe(1);
    expect(dry.err.split("\n")).toEqual([
      'error E0105 undef-tile at 4:25: Reference to undefined tile "Missing"',
      expect.stringMatching(/^warning W0212 ui-event-tile-mismatch at 2:24: /),
    ]);
  });

  it("names the severity of a proposal's diagnostic, and of one it has no patch for", async () => {
    write([
      ...WARNING,
      "slot count : Int = 0",
      "reducer bump on=ui.click(Go) do= count := conut + 1",
      'tile Go = button(text="go")',
      "tile App = column(Card, Go, Missing)",
      ...APP,
    ]);
    const dry = await printed(() => fixCmd(file, false));
    expect(dry.result).toBe(1);
    expect(dry.out.split("\n")).toEqual([
      'error E0103 undef-ref at 5:43: Reference to undefined name "conut"',
      '  fix: replace "conut" with "count" at 5:43',
      "(no auto-patch for 1 of 2)",
    ]);
    expect(dry.err.split("\n")).toEqual([
      'error E0105 undef-tile at 7:29: Reference to undefined tile "Missing" [no-close-name-suggestion]',
      expect.stringMatching(/^warning W0212 ui-event-tile-mismatch at 2:24: /),
    ]);
  });

  it("names the severity of what blocks --auto-patch and of the warnings beside it", async () => {
    write([
      ...WARNING,
      'tile Title = heading("Helo")',
      "tile App = column(Card, Title, Missing)",
      ...APP,
      ...FAILING_TEST,
    ]);
    const auto = await printed(() => fixFromTest(file, "t", false));
    expect(auto.result.status).toBe("no-patch");
    expect(auto.err.split("\n")).toEqual([
      'error E0105 undef-tile at 5:32: Reference to undefined tile "Missing"',
      expect.stringMatching(/^warning W0212 ui-event-tile-mismatch at 2:24: /),
    ]);
  });

  it("says plain `no errors` when there is nothing at all", async () => {
    write(['tile App = column(text("hi"))', ...APP]);
    const dry = await printed(() => fixCmd(file, false));
    expect(dry.result).toBe(0);
    expect(dry.out).toBe("no errors");
    expect(dry.err).toBe("");
  });
});
