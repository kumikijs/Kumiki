import * as fs from "node:fs";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gateComposed } from "@kumikijs/cli";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it, vi } from "vitest";
import { serialiseFixFromTest } from "../src/index.ts";
import {
  callOnce,
  FIX_COUNTER_TESTS,
  FIX_COUNTER_TYPO_WITH_TEST,
  FIX_FAILING_SINGLE,
  FIX_REGRESSION,
  type ToolResult,
  useWorkdir,
} from "./helpers/client.ts";

// A plain-object namespace, so `vi.spyOn(fs, ...)` can replace an export.
vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));

const REFUSED_TAIL = [
  'tile Btn1 = button(text="+")',
  "tile App = column(Btn1)",
  "app A",
  "    caps   = []",
  '    routes = {"/" -> App, "/404" -> App}',
  "    init   = []",
];

type Outcome = Record<string, unknown> & { ok: boolean; status: string };

const outcome = (res: ToolResult): Outcome => JSON.parse(res.body) as Outcome;

describe("kumiki_auto_patch", { timeout: 30000 }, () => {
  const workdir = useWorkdir();
  const copy = (from: string, name: string): string => {
    const file = join(workdir.path, name);
    copyFileSync(from, file);
    return file;
  };
  const write = (name: string, lines: string[]): string => {
    const file = join(workdir.path, name);
    writeFileSync(file, [...lines, ""].join("\n"));
    return file;
  };

  it("applies a compile-tier fix and reaches already-pass on a fixture where the test then passes", async () => {
    const file = copy(FIX_COUNTER_TYPO_WITH_TEST, "typo-with-test.kumiki");
    const res = await callOnce("kumiki_auto_patch", {
      path: file,
      testName: "inc-works",
      apply: true,
    });
    const parsed = outcome(res);
    expect(parsed.status).toBe("already-pass");
    expect(parsed.compileFixes).toBeGreaterThan(0);
    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("conut");
    expect(after).toContain("count := count + 1");
  });

  it("serialises a gate refusal as compile-blocked, naming what the patch would have added", async () => {
    const file = write("repair-introduces.kumiki", [
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
    ]);
    const original = readFileSync(file, "utf8");
    const res = await callOnce("kumiki_auto_patch", { path: file, testName: "bumps", apply: true });
    type Wire = { code: string; severity: string };
    const parsed = outcome(res) as Outcome & {
      compileErrors?: Wire[];
      blocked?: { reason: string; introduced?: Wire[] };
    };
    expect(parsed.status).toBe("compile-blocked");
    expect(parsed.blocked?.reason).toBe("introduced");
    expect(parsed.blocked?.introduced?.map((d) => [d.code, d.severity])).toEqual([
      ["E0201", "error"],
    ]);
    expect(parsed.compileErrors?.map((d) => [d.code, d.severity])).toEqual([["E0103", "error"]]);
    expect(parsed.compileFixes).toBeUndefined();
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  describe("puts the file's warnings beside the outcome", () => {
    const WARNING = [
      'slot f : Text = ""',
      'reducer recordFocus on=ui.focus(Card) do= f := "focused"',
      'tile Card = box(text("hi"))',
    ];
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
    type Wire = { code: string; severity: string };
    const pairs = (ds: unknown) => (ds as Wire[] | undefined)?.map((d) => [d.code, d.severity]);

    it("on the compile tier, apart from the error that blocks the test", async () => {
      const file = write("warned.kumiki", [
        ...WARNING,
        'tile Title = heading("Helo")',
        "tile App = column(Card, Title, Missing)",
        ...APP,
        ...FAILING_TEST,
      ]);
      const parsed = outcome(await callOnce("kumiki_auto_patch", { path: file, testName: "t" }));
      expect(parsed.status).toBe("no-patch");
      expect(pairs(parsed.compileErrors)).toEqual([["E0105", "error"]]);
      expect(pairs(parsed.warnings)).toEqual([["W0212", "warning"]]);
    });

    it("on the behavioural tier, after the repair it wrote", async () => {
      const file = write("warned.kumiki", [
        ...WARNING,
        'tile Title = heading("Helo")',
        "tile App = column(Card, Title)",
        ...APP,
        ...FAILING_TEST,
      ]);
      const parsed = outcome(
        await callOnce("kumiki_auto_patch", { path: file, testName: "t", apply: true }),
      );
      expect(parsed.status).toBe("applied");
      expect(parsed.compileErrors).toBeUndefined();
      expect(pairs(parsed.warnings)).toEqual([["W0212", "warning"]]);
    });
  });

  it("serialises a refusal over unparseable source as compile-blocked, with the parser's message", () => {
    const source = [
      'tile App = column(heading("hi"))',
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App}',
      "    init   = []",
      "",
    ].join("\n");
    const errors = check(parse(lex(source))).filter((e) => e.severity !== "warning");
    const broken = source.replace('{"/" -> App}', '{"/" -> App, "/404" -> NotFound');
    let message = "";
    try {
      parse(lex(broken));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^Parse error at /);
    const verdict = gateComposed(errors, broken);
    if (verdict.blocked === undefined) throw new Error("the gate passed text that does not parse");
    const wire = serialiseFixFromTest({
      ok: false,
      status: "compile-blocked",
      compileErrors: errors,
      blocked: verdict.blocked,
      warnings: [],
    });
    expect(wire).toEqual({
      ok: false,
      status: "compile-blocked",
      compileErrors: [
        {
          code: "E0001",
          kind: "missing-404",
          message: 'app.routes must include a "/404" entry',
          line: 2,
          col: 1,
          severity: "error",
        },
      ],
      blocked: { reason: "parse-error", message },
      warnings: [],
    });
  });

  it("a dry run on a test that already passes reports already-pass and writes nothing", async () => {
    const file = copy(FIX_COUNTER_TESTS, "counter-tests.kumiki");
    const original = readFileSync(file, "utf8");
    const res = await callOnce("kumiki_auto_patch", { path: file, testName: "inc-works" });
    expect(res.isError).toBe(false);
    expect(outcome(res).status).toBe("already-pass");
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("flags a dry run that only proposed, and an unknown test name", async () => {
    const file = copy(FIX_FAILING_SINGLE, "failing.kumiki");
    const proposed = await callOnce("kumiki_auto_patch", {
      path: file,
      testName: "greet-should-say-planet",
    });
    expect(proposed.isError).toBe(true);
    expect(outcome(proposed).status).toBe("proposed");
    const unknown = await callOnce("kumiki_auto_patch", { path: file, testName: "no-such-test" });
    expect(unknown.isError).toBe(true);
    expect(outcome(unknown).status).toBe("not-found");
  });

  it("applies on a single-test fixture: FAIL → PASS with regressed:[], not flagged", async () => {
    const file = copy(FIX_FAILING_SINGLE, "failing-single.kumiki");
    const res = await callOnce("kumiki_auto_patch", {
      path: file,
      testName: "greet-should-say-planet",
      apply: true,
    });
    expect(res.isError).toBe(false);
    expect(outcome(res)).toMatchObject({
      status: "applied",
      pass: true,
      ok: true,
      regressed: [],
      patch: { code: "TEST" },
    });
    const after = readFileSync(file, "utf8");
    expect(after).toContain('greeting := "planet"');
    expect(after).not.toContain('greeting := "world"');
  });

  it("refuses a patch that would break another test, and leaves the file alone", async () => {
    const file = copy(FIX_REGRESSION, "regression.kumiki");
    const original = readFileSync(file, "utf8");
    const res = await callOnce("kumiki_auto_patch", { path: file, testName: "A", apply: true });
    expect(outcome(res)).toMatchObject({
      status: "test-blocked",
      ok: false,
      patch: { code: "TEST" },
      blocked: { reason: "regressed", regressed: ["B"] },
    });
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("serialises an `introduced` refusal's errors as wire diagnostics", async () => {
    const file = write("introduced.kumiki", [
      "type Small = nominal Int where between(2, 5)",
      "slot count : Int = 0",
      "slot pick : Small = 2",
      "reducer inc on=ui.click(Btn1) do= count := 2 + 3",
      ...REFUSED_TAIL,
      "test sets-one =",
      "    reducer-test inc",
      "        given  = {slots: {count: 0}, event: {type: ui.click, target: Btn1}}",
      "        expect = {slots: {count: 1}, effects: []}",
    ]);
    const original = readFileSync(file, "utf8");
    const res = await callOnce("kumiki_auto_patch", {
      path: file,
      testName: "sets-one",
      apply: true,
    });
    const parsed = outcome(res) as Outcome & {
      blocked: { reason: string; introduced: Array<Record<string, unknown>> };
    };
    expect(parsed.status).toBe("test-blocked");
    expect(parsed.blocked.reason).toBe("introduced");
    expect(parsed.blocked.introduced).toHaveLength(1);
    expect(Object.keys(parsed.blocked.introduced[0] ?? {}).sort()).toEqual([
      "code",
      "col",
      "kind",
      "line",
      "message",
      "severity",
    ]);
    expect(parsed.blocked.introduced[0]).toMatchObject({
      code: "E0804",
      line: 1,
      severity: "error",
    });
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("serialises a `still-fails` refusal with the test's result", async () => {
    // The one token `1` is `other`'s; replacing it leaves the test failing.
    const file = write("still-fails.kumiki", [
      "slot count : Int = 0",
      "slot other : Int = 1",
      "fn step() -> Int = 3 - 2",
      "reducer inc on=ui.click(Btn1) do= count := count + step()",
      ...REFUSED_TAIL,
      "test inc-adds-two =",
      "    reducer-test inc",
      "        given  = {slots: {count: 0}, event: {type: ui.click, target: Btn1}}",
      "        expect = {slots: {count: 2}, effects: []}",
    ]);
    const original = readFileSync(file, "utf8");
    const res = await callOnce("kumiki_auto_patch", {
      path: file,
      testName: "inc-adds-two",
      apply: true,
    });
    expect(outcome(res)).toMatchObject({
      status: "test-blocked",
      blocked: {
        reason: "still-fails",
        failingTest: {
          name: "inc-adds-two",
          pass: false,
          diffAt: "slots.count",
          leaf: { expected: 2, actual: 1 },
        },
      },
    });
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("serialises the write-failed variant: status, phase, writeError, patch without its closure", async () => {
    const file = copy(FIX_FAILING_SINGLE, "failing-single.kumiki");
    const before = readFileSync(file, "utf8");
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("EBUSY: simulated for wire test");
    });
    try {
      const res = await callOnce("kumiki_auto_patch", {
        path: file,
        testName: "greet-should-say-planet",
        apply: true,
      });
      const parsed = outcome(res) as Outcome & {
        phase?: string;
        writeError?: string;
        patch?: Record<string, unknown>;
      };
      expect(parsed).toMatchObject({ status: "write-failed", ok: false, phase: "test" });
      expect(parsed.writeError).toContain("EBUSY");
      expect(parsed.patch).toEqual({ code: "TEST", description: expect.any(String) });
    } finally {
      writeSpy.mockRestore();
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
