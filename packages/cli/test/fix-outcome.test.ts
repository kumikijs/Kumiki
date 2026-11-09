import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import {
  applyFixPlan,
  fixCmd,
  fixFromTest,
  planFixesExplained,
  runFixFromTest,
} from "@kumikijs/cli";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printed } from "./helpers/console.ts";
import { APP_A, seed, storeOf } from "./helpers/files.ts";

vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));

afterEach(() => {
  vi.restoreAllMocks();
});

/** An effect needing `log.write` that `caps = []` lacks: E0301, which has a deterministic repair. */
const NEEDS_LOG_WRITE = `effect logHello cap=log.write
                in=Text
                out=Unit

reducer greet on=app.start do= emit logHello("hi")
`;

/** A counter app whose reducer `name` does `count := count <op>`, under a test `t`. */
const counterWithTest = (opts: {
  reducer: string;
  op: string;
  start: number;
  given: number;
  expected: number;
}) => `slot count : Int = ${opts.start}
reducer ${opts.reducer} on=ui.click(B) do= count := count ${opts.op}
tile B = button(text="${opts.reducer}")
tile App = column(B, text(count.show))
${APP_A}test t =
    reducer-test ${opts.reducer}
        given  = {slots: {count: ${opts.given}}, event: {type: ui.click, target: B}}
        expect = {slots: {count: ${opts.expected}}}
`;

/** Compiles and passes. */
const PASSING = counterWithTest({ reducer: "inc", op: "+ 1", start: 0, given: 0, expected: 1 });
/** Fails, and the arithmetic tier repairs it. */
const REPAIRABLE = counterWithTest({ reducer: "dec", op: "+ 1", start: 0, given: 5, expected: 4 });
/** Fails, and no tier can repair it. */
const UNREPAIRABLE = counterWithTest({
  reducer: "dbl",
  op: "* 2",
  start: 1,
  given: 2,
  expected: 5,
});

const failWrites = (message: string) =>
  vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
    throw new Error(message);
  });

describe("write-failure handling", () => {
  it("applyFixPlan: a failed write sets writeError, applies nothing, and leaves the file", () => {
    const file = seed(`${NEEDS_LOG_WRITE}tile App = heading("hi")\n${APP_A}`);
    const before = readFileSync(file, "utf8");
    failWrites("EACCES: simulated write failure");
    const result = applyFixPlan(file, "E0301");
    expect(result.writeError).toContain("EACCES");
    expect(result.applied).toBe(0);
    expect(result.regressionBlocked).toBeFalsy();
    expect(result.parseError).toBeUndefined();
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("fixCmd: a failed write exits 1 and says so on stderr", async () => {
    const file = seed(`${NEEDS_LOG_WRITE}tile App = heading("hi")\n${APP_A}`);
    const before = readFileSync(file, "utf8");
    failWrites("EACCES: simulated fixCmd");
    const said = await printed(() => fixCmd(file, true));
    expect(said.result).toBe(1);
    expect(said.err).toContain(`could not write fixes to ${file}`);
    expect(said.err).toContain("EACCES");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("runFixFromTest: a failed compile-tier write is write-failed in phase compile", async () => {
    const file = seed(`${NEEDS_LOG_WRITE}${PASSING}`);
    const before = readFileSync(file, "utf8");
    failWrites("ENOSPC: simulated no space");
    const outcome = await runFixFromTest(file, "t", true);
    expect(outcome).toMatchObject({
      status: "write-failed",
      phase: "compile",
      writeError: expect.stringContaining("ENOSPC"),
      compileFixes: 1,
    });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("runFixFromTest: a failed test-tier write is write-failed in phase test, with its patch", async () => {
    const file = seed(REPAIRABLE);
    const before = readFileSync(file, "utf8");
    failWrites("EBUSY: simulated busy");
    const outcome = await runFixFromTest(file, "t", true);
    expect(outcome).toMatchObject({
      status: "write-failed",
      phase: "test",
      writeError: expect.stringContaining("EBUSY"),
      patch: { description: expect.stringContaining("count := count") },
    });
    expect(outcome).not.toHaveProperty("compileFixes");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("runFixFromTest: a compile write that landed is carried by a later test-tier failure", async () => {
    const file = seed(`${NEEDS_LOG_WRITE}${REPAIRABLE}`);
    const realWrite = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync")
      .mockImplementationOnce((...args: Parameters<typeof fs.writeFileSync>) => {
        realWrite(...args);
      })
      .mockImplementation(() => {
        throw new Error("EBUSY: second-write simulated");
      });
    const outcome = await runFixFromTest(file, "t", true);
    expect(outcome).toMatchObject({
      status: "write-failed",
      phase: "test",
      writeError: expect.stringContaining("EBUSY"),
      patch: expect.anything(),
      compileFixes: 1,
    });
    expect(readFileSync(file, "utf8")).toContain("log.write");
  });

  it("fixFromTest: a failed test-tier write prints `could not write test patch`", async () => {
    const file = seed(REPAIRABLE);
    failWrites("EBUSY: simulated");
    const said = await printed(() => fixFromTest(file, "t", true));
    expect(said.result.status).toBe("write-failed");
    expect(said.err).toContain('could not write test patch for "t"');
    expect(said.err).toContain("EBUSY");
  });

  it("fixFromTest: a failed compile-tier write does not claim the compile fixes were applied", async () => {
    const file = seed(`${NEEDS_LOG_WRITE}${PASSING}`);
    failWrites("ENOSPC: simulated");
    const said = await printed(() => fixFromTest(file, "t", true));
    expect(said.out).not.toMatch(/applied \d+ compile fix\(es\)/);
    expect(said.err).toContain('could not write compile fix for "t"');
    expect(said.err).toContain("ENOSPC");
  });
});

describe("FixFromTestOutcome.reason propagation and printer", () => {
  it("runFixFromTest: the compile tier lands both repairs when one line holds two", async () => {
    const file = seed(`slot seen : Bool = false
reducer clicked on=ui.click(B) do= seen := $route.path == $route.pattern
tile B = button(text="go")
tile App = column(B)
${APP_A}test t =
    reducer-test clicked
        given  = {slots: {seen: false}, event: {type: ui.click, target: B}}
        expect = {slots: {seen: true}}
`);
    expect(await runFixFromTest(file, "t", true)).toHaveProperty("compileFixes", 2);
    expect(readFileSync(file, "utf8")).toContain("seen := route.path == route.pattern");
  });

  it("the test tier's no-patch carries the planner's reason, and the printer shows it", async () => {
    const file = seed(UNREPAIRABLE);
    const { result: outcome, out } = await printed(() => fixFromTest(file, "t", false));
    expect(outcome).toMatchObject({
      status: "no-patch",
      reason: expect.stringMatching(/^multiplicative-/),
      failingTest: expect.anything(),
    });
    expect(out).toMatch(/reason:\s+multiplicative-/);
  });

  it("the compile tier's no-patch carries the first skip reason, and the printer shows it", async () => {
    const file = seed(`${NEEDS_LOG_WRITE}tile App = heading("hi")\n`);
    const { result: outcome, out } = await printed(() => fixFromTest(file, "t", false));
    expect(outcome).toMatchObject({ status: "no-patch", reason: "e0301-no-app-def" });
    const codes = outcome.status === "no-patch" ? outcome.compileErrors?.map((e) => e.code) : [];
    expect(codes).toEqual(expect.arrayContaining(["E0301", "E0003"]));
    expect(out).toMatch(/reason: e0301-no-app-def/);
  });

  it("a test runner that throws is no-patch with reason test-runner-threw", async () => {
    const file = seed(PASSING);
    vi.resetModules();
    vi.doMock("../src/smoke.ts", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/smoke.ts")>()),
      testFile: () => {
        throw new Error("the generated module threw");
      },
    }));
    try {
      const { fixFromTest: withThrowingRunner } = await import("../src/fix.ts");
      const { result: outcome, err } = await printed(() => withThrowingRunner(file, "t", false));
      expect(outcome).toMatchObject({
        status: "no-patch",
        reason: "test-runner-threw",
        testRunError: expect.anything(),
      });
      expect(err).toContain("could not run tests");
      expect(err).toMatch(/reason:\s+test-runner-threw/);
    } finally {
      vi.doUnmock("../src/smoke.ts");
      vi.resetModules();
    }
  });
});

describe("KUMIKI_DEBUG=fix hook", () => {
  const noQuotedNameErr = {
    code: "E0102",
    kind: "type-error" as const,
    message: "no quoted name here",
    pos: { line: 1, col: 1 },
  };

  /** What planning one unexplained skip printed to console.warn under KUMIKI_DEBUG=`value`. */
  async function warnedUnder(...values: (string | undefined)[]): Promise<string> {
    const store = storeOf('tile A = heading("hi")\n');
    const { warned } = await printed(() => {
      for (const value of values) {
        vi.stubEnv("KUMIKI_DEBUG", value);
        planFixesExplained(store, [noQuotedNameErr]);
      }
    });
    return warned;
  }

  it("names the skip and its reason when KUMIKI_DEBUG=fix", async () => {
    const warned = await warnedUnder("fix");
    expect(warned).toContain("[kumiki fix] skip");
    expect(warned).toContain("quoted-name-extract-failed");
  });

  it.each([
    ["smoke,fix"],
    ["  smoke ,  fix  "],
  ])("is active for the scope list %o", async (value) => {
    expect(await warnedUnder(value)).not.toBe("");
  });

  it.each([
    ["unset", undefined],
    ["a different scope", "smoke"],
    ["empty", ""],
    ["whitespace-only", "   "],
    ["a scope that starts with fix", "fix-verbose"],
    ["a scope that ends with fix", "prefix-of-fix"],
  ])("is silent when KUMIKI_DEBUG is %s", async (_, value) => {
    expect(await warnedUnder(value)).toBe("");
  });
});
