// The op log is JSONL: one op per line, each line ending in a newline. A last
// line with no newline after it that does not parse is skipped with a warning
// naming the log and the line, and the next op logged takes its place. Any
// other line that is not an op stops the read with the log's path and the
// line's number, and a write op that meets one is rejected with the file and
// the log left byte-identical.

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDef, readOpLog, replaceDef, viewHistory } from "@kumikijs/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The start of an op-log line, cut off mid-key. */
const TORN = '{"op":"replace","layer":"slot","na';

let dir = "";
let file = "";
let warnings: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-op-log-lines-"));
  file = join(dir, "c.kumiki");
  writeFileSync(file, "slot a : Int = 0\n");
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(" "));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const logPath = (): string => `${file}.kumiki-ops.jsonl`;
const logText = (): string => readFileSync(logPath(), "utf8");

/** Every line of the log, each parsed on its own: what a strict reader sees. */
const logLines = (): Array<Record<string, unknown>> => {
  const text = logText();
  expect(text.endsWith("\n")).toBe(true);
  return text
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const skipped = (line: number): string =>
  `warning: ${logPath()}:${line}: skipped the last line, which is not valid JSON and has no newline after it; the next op logged replaces it`;

describe("an op log whose last line is torn", () => {
  it("reads as its complete entries, with a warning naming the log and the line", () => {
    const first = replaceDef(file, "slot.a", "Int = 1");
    appendFileSync(logPath(), TORN);

    expect(readOpLog(file).map((e) => e["op-id"])).toEqual([first]);
    expect(viewHistory(file, "slot.a").map((e) => e["op-id"])).toEqual([first]);
    expect(warnings).toEqual([skipped(2), skipped(2)]);
  });

  it("takes the next write, logged after the last complete entry", () => {
    const first = replaceDef(file, "slot.a", "Int = 1");
    appendFileSync(logPath(), TORN);

    const second = replaceDef(file, "slot.a", "Int = 7");

    expect(readFileSync(file, "utf8")).toContain("slot a : Int = 7");
    expect(logLines().map((e) => e["op-id"])).toEqual([first, second]);
    expect(logLines()[1]?.["parent-ops"]).toEqual([first]);
    expect(warnings).toEqual([skipped(2)]);
  });

  it("takes the next write when it is the only line", () => {
    writeFileSync(logPath(), TORN);

    const id = addDef(file, "slot", "b", "Int = 0");

    expect(logLines().map((e) => e["op-id"])).toEqual([id]);
    expect(logLines()[0]?.["parent-ops"]).toEqual([]);
    expect(warnings).toEqual([skipped(1)]);
  });
});

describe("an op log whose last entry has no newline after it", () => {
  it("puts the next entry on a line of its own", () => {
    const first = replaceDef(file, "slot.a", "Int = 1");
    writeFileSync(logPath(), logText().trimEnd());

    const second = replaceDef(file, "slot.a", "Int = 7");

    expect(logLines().map((e) => e["op-id"])).toEqual([first, second]);
    expect(warnings).toEqual([]);
  });
});

describe("an op log with a line that is not an op", () => {
  it.each([
    ["not JSON, with entries after it", (good: string) => `${TORN}\n${good}`, 1, "not valid JSON"],
    [
      "not JSON, with a newline after it",
      (good: string) => `${good}${TORN}\n`,
      2,
      "not valid JSON",
    ],
    ["JSON that is not an object", (good: string) => `${good}null\n`, 2, "not an op object"],
  ])("names the log and the line when it is %s", (_, layout, line, problem) => {
    replaceDef(file, "slot.a", "Int = 1");
    writeFileSync(logPath(), layout(logText()));
    const before = { source: readFileSync(file, "utf8"), log: logText() };
    const where = `${logPath()}:${line}: ${problem}`;

    expect(() => readOpLog(file)).toThrowError(where);
    expect(() => viewHistory(file, "slot.a")).toThrowError(where);
    expect(() => replaceDef(file, "slot.a", "Int = 7")).toThrowError(
      `replace rejected: the op could not be logged (${where}`,
    );
    expect({ source: readFileSync(file, "utf8"), log: logText() }).toEqual(before);
    expect(warnings).toEqual([]);
  });
});
