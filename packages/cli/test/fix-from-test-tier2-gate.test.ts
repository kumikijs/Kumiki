import { readFileSync, writeFileSync } from "node:fs";
import { fixFromTest, planTestPatchExplained, runFixFromTest } from "@kumikijs/cli";
import { check, lex, parse } from "@kumikijs/compiler";
import type { TestResult } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedLines } from "./helpers/files.ts";

const gateRunner = vi.hoisted(() => ({
  override: null as null | (() => Promise<TestResult[]>),
}));
vi.mock("../src/smoke.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/smoke.ts")>();
  return {
    ...actual,
    runTestsSource: (...args: Parameters<typeof actual.runTestsSource>) =>
      gateRunner.override ? gateRunner.override() : actual.runTestsSource(...args),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const APP_TAIL = [
  "tile App = column(Btn1)",
  "",
  "app A",
  "    caps   = []",
  '    routes = {"/" -> App, "/404" -> App}',
  "    init   = []",
];

const ADDS_TWO_TEST = [
  "test inc-adds-two =",
  "    reducer-test inc",
  "        given  = {slots: {count: 0}, event: {type: ui.click, target: Btn1}}",
  "        expect = {slots: {count: 2}, effects: []}",
];

/** The only whole token `1` outside the test is `step`'s body. */
const DIGIT_IN_IDENTIFIER = [
  "slot count : Int = 0",
  "fn step() -> Int = 1",
  "reducer inc on=ui.click(Btn1) do= count := count + step()",
  'tile Btn1 = button(text="+")',
  ...APP_TAIL,
  ...ADDS_TWO_TEST,
];

/** `10` holds a `1` and sits in the reducer the test targets. */
const DIGIT_IN_NUMBER = [
  "slot count : Int = 0",
  "fn step() -> Int = 1",
  "reducer inc on=ui.click(Btn1) do= count := if count > 10 then 0 else count + step()",
  'tile Btn1 = button(text="+")',
  ...APP_TAIL,
  ...ADDS_TWO_TEST,
];

/** A tile-test whose target reads `items[0]` of an empty list, a panic as it renders. */
const THROWING_TEST = [
  "slot items : List(Int) = []",
  'tile First = heading("First: " + items[0].show)',
  "test first-shows =",
  "    tile-test First",
  "        given  = {slots: {items: []}}",
  '        expect = heading("First: 1")',
];
const THROWN = "Index 0 is out of range for a List of length 0";

/** A failing reducer-test result on `slots.count`, for calling the planner directly. */
const failingLeaf = (actual: unknown, expected: unknown): TestResult => ({
  name: "t",
  pass: false,
  diffAt: "slots.count",
  leaf: { actual, expected },
});

const compiles = (src: string): boolean =>
  check(parse(lex(src))).filter((d) => d.severity !== "warning").length === 0;

describe("a behavioural candidate is a whole token", () => {
  it("never takes the digit inside an identifier", async () => {
    const file = seedLines(DIGIT_IN_IDENTIFIER);
    const outcome = await runFixFromTest(file, "inc-adds-two", true);

    const after = readFileSync(file, "utf8");
    expect(after).toContain("reducer inc on=ui.click(Btn1)");
    expect(after).toContain("fn step() -> Int = 2");
    expect(compiles(after)).toBe(true);
    expect(outcome.status).toBe("applied");
  });

  it("never takes the digit inside a larger number", async () => {
    const file = seedLines(DIGIT_IN_NUMBER);
    const outcome = await runFixFromTest(file, "inc-adds-two", true);

    const after = readFileSync(file, "utf8");
    expect(after).toContain("if count > 10 then");
    expect(after).toContain("fn step() -> Int = 2");
    expect(outcome.status).toBe("applied");
  });

  it("never takes a digit inside a comment", async () => {
    const file = seedLines([
      "slot count : Int = 0",
      "fn step() -> Int = 3 - 2",
      "# bump by 1",
      "reducer inc on=ui.click(Btn1) do= count := count + step()",
      'tile Btn1 = button(text="+")',
      ...APP_TAIL,
      ...ADDS_TWO_TEST,
    ]);
    const before = readFileSync(file, "utf8");
    const outcome = await runFixFromTest(file, "inc-adds-two", false);

    expect(outcome.status).toBe("no-patch");
    expect(readFileSync(file, "utf8")).toBe(before);
    const exact = planTestPatchExplained(before, failingLeaf(1, 2));
    expect(exact.patch).toBeNull();
    if (exact.patch === null) expect(exact.reason).toBe("no-scoped-literal-hit");
  });
});

describe("the whole-token rule, on the exact-literal planner alone", () => {
  it("takes `-1` written as a negative number, and not the `-1` inside `count-1`", () => {
    const source = ["slot count-1 : Int = 0", "slot base : Int = -1", ""].join("\n");
    const planned = planTestPatchExplained(source, failingLeaf(-1, 3));

    expect(planned.patch?.apply(source)).toBe(
      ["slot count-1 : Int = 0", "slot base : Int = 3", ""].join("\n"),
    );
  });

  it("takes `true` as a token, and not the `true` inside `is-true`", () => {
    const source = ["slot is-true : Bool = false", "slot flag : Bool = true", ""].join("\n");
    const planned = planTestPatchExplained(source, failingLeaf(true, false));

    expect(planned.patch?.apply(source)).toBe(
      ["slot is-true : Bool = false", "slot flag : Bool = false", ""].join("\n"),
    );
  });

  it("reports a source that does not lex as that, not as a missing literal", () => {
    const planned = planTestPatchExplained(
      'slot base : Int = 1\nslot s : Text = "open',
      failingLeaf(1, 2),
    );

    expect(planned.patch).toBeNull();
    if (planned.patch === null) expect(planned.reason).toBe("source-does-not-lex");
  });
});

describe("token offsets on a line with CRLF, tabs and non-ASCII text", () => {
  it("still repairs the literal", async () => {
    const file = seedLines([]);
    const src = [
      "slot count : Int = 0",
      'fn step() -> Int =\tif "ü🎌" == "é" then 5 else 1',
      "reducer inc on=ui.click(Btn1) do= count := count + step()",
      'tile Btn1 = button(text="🎌+")',
      ...APP_TAIL,
      ...ADDS_TWO_TEST,
      "",
    ].join("\r\n");
    writeFileSync(file, src);

    const outcome = await runFixFromTest(file, "inc-adds-two", true);

    expect(outcome.status).toBe("applied");
    expect(readFileSync(file, "utf8")).toBe(src.replace("else 1", "else 2"));
  });
});

describe("the behavioural write is gated", () => {
  it("refuses a patch after which the named test still fails", async () => {
    // The one whole token `1` is an unrelated slot's initial value.
    const file = seedLines([
      "slot count : Int = 0",
      "slot other : Int = 1",
      "fn step() -> Int = 3 - 2",
      "reducer inc on=ui.click(Btn1) do= count := count + step()",
      'tile Btn1 = button(text="+")',
      ...APP_TAIL,
      ...ADDS_TWO_TEST,
    ]);
    const before = readFileSync(file, "utf8");
    const outcome = await runFixFromTest(file, "inc-adds-two", true);

    expect(readFileSync(file, "utf8")).toBe(before);
    expect(outcome.status).toBe("test-blocked");
    expect(outcome.ok).toBe(false);
    if (outcome.status === "test-blocked") {
      expect(outcome.blocked.reason).toBe("still-fails");
      expect(outcome.patch.description).toContain("replace 1 with 2");
    }
  });

  it("reports a patch that does not compile as an outcome, and writes nothing", async () => {
    const file = seedLines([
      "type Small = nominal Int where between(2, 5)",
      "slot count : Int = 0",
      "slot pick : Small = 2",
      "reducer inc on=ui.click(Btn1) do= count := 2 + 3",
      'tile Btn1 = button(text="+")',
      ...APP_TAIL,
      "test sets-one =",
      "    reducer-test inc",
      "        given  = {slots: {count: 0}, event: {type: ui.click, target: Btn1}}",
      "        expect = {slots: {count: 1}, effects: []}",
    ]);
    const before = readFileSync(file, "utf8");
    const outcome = await runFixFromTest(file, "sets-one", true);

    expect(readFileSync(file, "utf8")).toBe(before);
    expect(outcome.status).toBe("test-blocked");
    if (outcome.status === "test-blocked" && outcome.blocked.reason === "introduced") {
      expect(outcome.blocked.introduced.map((e) => e.code)).toEqual(["E0804"]);
    } else {
      expect.unreachable(`expected an introduced refusal, got ${JSON.stringify(outcome)}`);
    }
  });

  it("refuses a patch that makes another passing test fail", async () => {
    const file = seedLines([
      'slot message : Text = ""',
      'reducer greet on=ui.click(Btn1) do= message := "world"',
      'tile Btn1 = button(text="+")',
      ...APP_TAIL,
      "test A =",
      "    reducer-test greet",
      '        given  = {slots: {message: ""}, event: {type: ui.click, target: Btn1}}',
      '        expect = {slots: {message: "planet"}, effects: []}',
      "test B =",
      "    reducer-test greet",
      '        given  = {slots: {message: ""}, event: {type: ui.click, target: Btn1}}',
      '        expect = {slots: {message: "world"}, effects: []}',
    ]);
    const before = readFileSync(file, "utf8");
    const outcome = await runFixFromTest(file, "A", true);

    expect(readFileSync(file, "utf8")).toBe(before);
    expect(outcome.status).toBe("test-blocked");
    if (outcome.status === "test-blocked") {
      expect(outcome.blocked).toEqual({ reason: "regressed", regressed: ["B"] });
    }
  });

  it("says the patch was refused and the file left unchanged", async () => {
    const file = seedLines([
      "slot count : Int = 0",
      "slot other : Int = 1",
      "fn step() -> Int = 3 - 2",
      "reducer inc on=ui.click(Btn1) do= count := count + step()",
      'tile Btn1 = button(text="+")',
      ...APP_TAIL,
      ...ADDS_TWO_TEST,
    ]);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => void lines.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m: unknown) => void lines.push(String(m)));

    await fixFromTest(file, "inc-adds-two", true);

    const out = lines.join("\n");
    expect(out).toContain('refused fix for "inc-adds-two" — file left unchanged');
    expect(out).toContain("reason: still-fails");
    expect(out).toContain("diff at:  slots.count");
    expect(out).not.toContain("applied fix");
  });
});

/** One whole token `1`, an unrelated slot's: the patch is found and the test still fails. */
const STILL_FAILS = [
  "slot count : Int = 0",
  "slot other : Int = 1",
  "fn step() -> Int = 3 - 2",
  "reducer inc on=ui.click(Btn1) do= count := count + step()",
  'tile Btn1 = button(text="+")',
  ...APP_TAIL,
  ...ADDS_TWO_TEST,
];

describe("a refusal after the compile tier wrote", () => {
  const TYPO_THEN_STILL_FAILS = STILL_FAILS.map((l) =>
    l.startsWith("reducer inc") ? l.replace("step()", "stpe()") : l,
  );

  it("keeps the compile fix and does not write the behavioural patch", async () => {
    // Pins the outcome, which was already right; the message is the next test.
    const file = seedLines(TYPO_THEN_STILL_FAILS);
    const outcome = await runFixFromTest(file, "inc-adds-two", true);

    expect(outcome.status).toBe("test-blocked");
    if (outcome.status === "test-blocked") {
      expect(outcome.compileFixes).toBe(1);
      expect(outcome.blocked.reason).toBe("still-fails");
    }
    expect(readFileSync(file, "utf8")).toBe(`${STILL_FAILS.join("\n")}\n`);
  });

  it("says the behavioural patch was not written, not that the file is unchanged", async () => {
    const file = seedLines(TYPO_THEN_STILL_FAILS);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => void lines.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m: unknown) => void lines.push(String(m)));

    await fixFromTest(file, "inc-adds-two", true);

    const out = lines.join("\n");
    expect(out).toContain("applied 1 compile fix(es)");
    expect(out).toContain(
      'refused fix for "inc-adds-two" — behavioural patch not written (compile fixes kept)',
    );
    expect(out).not.toContain("file left unchanged");
  });
});

describe("the gate judges only tests that passed before", () => {
  it("writes the patch while another test that already failed keeps failing", async () => {
    const file = seedLines([
      ...DIGIT_IN_IDENTIFIER,
      "test wants-seven =",
      "    reducer-test inc",
      "        given  = {slots: {count: 0}, event: {type: ui.click, target: Btn1}}",
      "        expect = {slots: {count: 7}, effects: []}",
    ]);
    const outcome = await runFixFromTest(file, "inc-adds-two", true);

    expect(outcome.status).toBe("applied");
    expect(readFileSync(file, "utf8")).toContain("fn step() -> Int = 2");
  });

  it("writes the patch when it also fixes another failing test", async () => {
    const file = seedLines([
      ...DIGIT_IN_IDENTIFIER,
      "test also-two =",
      "    reducer-test inc",
      "        given  = {slots: {count: 0}, event: {type: ui.click, target: Btn1}}",
      "        expect = {slots: {count: 2}, effects: []}",
    ]);
    const outcome = await runFixFromTest(file, "inc-adds-two", true);

    expect(outcome.status).toBe("applied");
    expect(readFileSync(file, "utf8")).toContain("fn step() -> Int = 2");
  });
});

describe("a test whose body throws", () => {
  it("is a failing test that says what it threw, with no patch planned from it", async () => {
    const file = seedLines([...DIGIT_IN_IDENTIFIER, ...THROWING_TEST]);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => void lines.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m: unknown) => void lines.push(String(m)));

    const outcome = await fixFromTest(file, "first-shows", false);

    expect(outcome.status).toBe("no-patch");
    if (outcome.status === "no-patch") expect(outcome.failingTest?.error).toBe(THROWN);
    const out = lines.join("\n");
    expect(out).toContain('(no auto-patch available) for failing test "first-shows":');
    expect(out).toContain(`  error:    ${THROWN}`);
  });

  it("does not keep another test in the file from being repaired", async () => {
    // `first-shows` fails before the patch and after it, so the gate does not
    // count it against the patch.
    const file = seedLines([...DIGIT_IN_IDENTIFIER, ...THROWING_TEST]);
    const outcome = await runFixFromTest(file, "inc-adds-two", true);

    expect(outcome.status).toBe("applied");
    expect(readFileSync(file, "utf8")).toContain("fn step() -> Int = 2");
  });
});

describe("the gate when the runner misbehaves on the patched source", () => {
  const withRunner = (override: () => Promise<TestResult[]>): typeof runFixFromTest => {
    gateRunner.override = override;
    return runFixFromTest;
  };
  afterEach(() => {
    gateRunner.override = null;
  });

  it("reports a runner that throws as test-runner-threw, with its message", async () => {
    const file = seedLines(DIGIT_IN_IDENTIFIER);
    const before = readFileSync(file, "utf8");
    const run = withRunner(async () => {
      throw new Error("the generated module threw");
    });

    const outcome = await run(file, "inc-adds-two", true);

    expect(outcome.status).toBe("test-blocked");
    if (outcome.status === "test-blocked") {
      expect(outcome.blocked).toEqual({
        reason: "test-runner-threw",
        message: "the generated module threw",
      });
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("reports a named test with no result as named-test-missing, not as a throw", async () => {
    const file = seedLines(DIGIT_IN_IDENTIFIER);
    const before = readFileSync(file, "utf8");
    const run = withRunner(async () => []);

    const outcome = await run(file, "inc-adds-two", true);

    expect(outcome.status).toBe("test-blocked");
    if (outcome.status === "test-blocked") {
      expect(outcome.blocked).toEqual({ reason: "named-test-missing" });
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("counts a test that passed before and has no result after as regressed", async () => {
    const file = seedLines([
      ...DIGIT_IN_IDENTIFIER,
      "test adds-one =",
      "    reducer-test inc",
      "        given  = {slots: {count: 0}, event: {type: ui.click, target: Btn1}}",
      "        expect = {slots: {count: 1}, effects: []}",
    ]);
    const before = readFileSync(file, "utf8");
    const run = withRunner(async () => [{ name: "inc-adds-two", pass: true }]);

    const outcome = await run(file, "inc-adds-two", true);

    expect(outcome.status).toBe("test-blocked");
    if (outcome.status === "test-blocked") {
      expect(outcome.blocked).toEqual({ reason: "regressed", regressed: ["adds-one"] });
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("a dry run is not gated", () => {
  it("proposes a patch the gate would refuse, and writes nothing", async () => {
    const file = seedLines(STILL_FAILS);
    const before = readFileSync(file, "utf8");
    const outcome = await runFixFromTest(file, "inc-adds-two", false);

    expect(outcome.status).toBe("proposed");
    if (outcome.status === "proposed") {
      expect(outcome.patch.description).toContain("replace 1 with 2");
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
