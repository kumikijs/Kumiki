// `fix --auto-patch --apply`'s behavioural tier replaces a literal the failing
// test's actual value names. Two rules keep that write inside the contract the
// compile tier already keeps — "the file comes out repaired or byte-identical":
//
//  - a candidate is a whole token, so a digit inside an identifier (`Btn1`) or
//    a larger number (`10`) is never one;
//  - the patched source is parsed, typechecked and tested before it is
//    written, and refused unless the named test passes and nothing regresses.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixFromTest, runFixFromTest } from "@kumikijs/cli";
import { check, lex, parse } from "@kumikijs/compiler";
import { afterEach, describe, expect, it, vi } from "vitest";

let dir = "";
const fixture = (lines: string[]): string => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-tier2-gate-"));
  const file = join(dir, "in.kumiki");
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
};
afterEach(() => {
  vi.restoreAllMocks();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
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

const compiles = (src: string): boolean =>
  check(parse(lex(src))).filter((d) => d.severity !== "warning").length === 0;

describe("a behavioural candidate is a whole token", () => {
  it("never takes the digit inside an identifier", async () => {
    const file = fixture(DIGIT_IN_IDENTIFIER);
    const outcome = await runFixFromTest(file, "inc-adds-two", true);

    const after = readFileSync(file, "utf8");
    expect(after).toContain("reducer inc on=ui.click(Btn1)");
    expect(after).toContain("fn step() -> Int = 2");
    expect(compiles(after)).toBe(true);
    expect(outcome.status).toBe("applied");
  });

  it("never takes the digit inside a larger number", async () => {
    const file = fixture(DIGIT_IN_NUMBER);
    const outcome = await runFixFromTest(file, "inc-adds-two", true);

    const after = readFileSync(file, "utf8");
    expect(after).toContain("if count > 10 then");
    expect(after).toContain("fn step() -> Int = 2");
    expect(outcome.status).toBe("applied");
  });

  it("never takes a digit inside a comment", async () => {
    const file = fixture([
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
  });
});

describe("the behavioural write is gated", () => {
  it("refuses a patch after which the named test still fails", async () => {
    // The one whole token `1` is an unrelated slot's initial value.
    const file = fixture([
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
    // The unique `5` is a refinement bound; replacing it with `1` puts the
    // lower bound above the upper one (E0804).
    const file = fixture([
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
    const file = fixture([
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
    const file = fixture([
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
    expect(out).not.toContain("applied fix");
  });
});
