import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addDef,
  editDef,
  type OpLogOptions,
  patchApplyFile,
  patchRevert,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
  type SkippedOpLogLine,
  viewHistory,
} from "@kumikijs/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, SPAWN } from "./helpers/cli.ts";
import { seed } from "./helpers/files.ts";
import { logPath as opLogOf } from "./helpers/op-log.ts";

/** The start of an op-log line, cut off mid-key. */
const TORN = '{"op":"replace","layer":"slot","na';

let file = "";
/** What the library printed with `console.warn`. */
let warnings: string[] = [];
/** What a verb handed to `report.onSkipped`. */
let reported: SkippedOpLogLine[] = [];
beforeEach(() => {
  file = seed("slot a : Int = 0\n", "c.kumiki");
  warnings = [];
  reported = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(" "));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The options a caller passes a verb to hear about a skipped line. */
const report: OpLogOptions = {
  onSkipped: (line) => {
    reported.push(line);
  },
};

const logPath = (): string => opLogOf(file);
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

/** The line of the log a read skipped. */
const at = (line: number): SkippedOpLogLine => ({ log: logPath(), line });

/** The CLI's warning about the line of the log a read skipped. */
const warning = (line: number): string =>
  `warning: ${logPath()}:${line}: skipped the last line, which is not valid JSON and has no newline after it; the next op logged replaces it`;

const ids = (entries: Array<{ "op-id": string }>): string[] => entries.map((e) => e["op-id"]);

describe("an op log whose last line is torn", () => {
  it("reads as its complete entries, handing the line it skipped to onSkipped", () => {
    const first = replaceDef(file, "slot.a", "Int = 1").opId;
    appendFileSync(logPath(), TORN);

    expect(ids(readOpLog(file, report))).toEqual([first]);
    expect(reported).toEqual([at(2)]);
    expect(ids(readOpLog(file))).toEqual([first]);
    expect(ids(viewHistory(file, "slot.a", report))).toEqual([first]);
    expect(reported).toEqual([at(2), at(2)]);
    expect(warnings).toEqual([]);
  });

  it("takes the next write, logged after the last complete entry", () => {
    const first = replaceDef(file, "slot.a", "Int = 1").opId;
    appendFileSync(logPath(), TORN);

    const second = replaceDef(file, "slot.a", "Int = 7", report).opId;

    expect(readFileSync(file, "utf8")).toContain("slot a : Int = 7");
    expect(logLines().map((e) => e["op-id"])).toEqual([first, second]);
    expect(logLines()[1]?.["parent-ops"]).toEqual([first]);
    expect(reported).toEqual([at(2)]);
    readOpLog(file, report);
    expect(reported).toEqual([at(2)]);
  });

  it("takes the next write when it is the only line", () => {
    writeFileSync(logPath(), TORN);
    expect(readOpLog(file, report)).toEqual([]);
    expect(reported).toEqual([at(1)]);

    const id = addDef(file, "slot", "b", "Int = 0", report);

    expect(logLines().map((e) => e["op-id"])).toEqual([id]);
    expect(logLines()[0]?.["parent-ops"]).toEqual([]);
    expect(reported).toEqual([at(1), at(1)]);
  });

  it("takes the next write after entries that end in CRLF", () => {
    const first = replaceDef(file, "slot.a", "Int = 1").opId;
    const entries = logText().replaceAll("\n", "\r\n");
    writeFileSync(logPath(), `${entries}${TORN}`);

    const second = replaceDef(file, "slot.a", "Int = 7", report).opId;

    expect(logText().startsWith(entries)).toBe(true);
    expect(logLines().map((e) => e["op-id"])).toEqual([first, second]);
    expect(reported).toEqual([at(2)]);
  });
});

describe("what a verb reports of an op log whose last line is torn", () => {
  let first = "";
  beforeEach(() => {
    first = replaceDef(file, "slot.a", "Int = 1").opId;
    appendFileSync(logPath(), TORN);
  });

  /** Each verb that reads the op log, called with `options`. */
  const verbs: Array<[string, (options?: OpLogOptions) => unknown]> = [
    ["add", (o) => addDef(file, "slot", "b", "Int = 0", o)],
    ["replace", (o) => replaceDef(file, "slot.a", "Int = 7", o)],
    ["edit", (o) => editDef(file, "slot.a", { find: "1", replace: "2" }, o)],
    ["rename", (o) => renameDef(file, "slot.a", "z", o)],
    ["remove", (o) => removeDef(file, "slot.a", false, o)],
    [
      "patch apply",
      (o) => {
        const ops = join(dirname(file), "ops.jsonl");
        writeFileSync(ops, '{"op":"add","layer":"slot","name":"b","body":"Int = 0"}\n');
        return patchApplyFile(file, ops, o);
      },
    ],
    // It reads the log for the op to revert, and again to log the revert.
    ["patch revert", (o) => patchRevert(file, first, o)],
    ["view --history", (o) => viewHistory(file, "slot.a", o)],
  ];

  it.each(verbs)("%s hands the skipped line to onSkipped once", (_, run) => {
    run(report);

    expect(reported).toEqual([at(2)]);
    expect(warnings).toEqual([]);
  });

  it.each(verbs)("%s prints nothing of it when given no onSkipped", (_, run) => {
    expect(logText().endsWith(`\n${TORN}`)).toBe(true);

    run();

    expect(warnings).toEqual([]);
  });

  it("hands it over before a patch revert whose op-id is not in the log", () => {
    // The op-id asked for may be the one on the torn line: the skipped line is
    // what says why it is not found.
    expect(() => patchRevert(file, "op_ON_THE_TORN_LINE", report)).toThrowError("not found in log");
    expect(reported).toEqual([at(2)]);
  });
});

describe("an op log with nothing to skip", () => {
  it.each([
    ["holds complete entries", true],
    ["is empty", false],
  ])("reads with nothing skipped when it %s", (_, kept) => {
    const first = replaceDef(file, "slot.a", "Int = 1").opId;
    if (!kept) writeFileSync(logPath(), "");
    const before = kept ? [first] : [];

    expect(ids(readOpLog(file, report))).toEqual(before);
    const next = replaceDef(file, "slot.a", "Int = 7", report).opId;
    expect(ids(viewHistory(file, "slot.a", report))).toEqual([...before, next]);
    expect(reported).toEqual([]);
  });

  it("reads with nothing skipped when there is no log", () => {
    expect(readOpLog(file, report)).toEqual([]);
    expect(viewHistory(file, "slot.a", report)).toEqual([]);
    expect(reported).toEqual([]);
  });
});

describe("an op log that cannot be read", () => {
  it("fails every verb that reads it, naming the log", () => {
    mkdirSync(logPath());
    const source = readFileSync(file, "utf8");
    const where = `${logPath()}: cannot be read (EISDIR`;

    expect(() => readOpLog(file)).toThrowError(where);
    expect(() => viewHistory(file, "slot.a", report)).toThrowError(where);
    expect(() => replaceDef(file, "slot.a", "Int = 7", report)).toThrowError(
      `replace rejected: the op could not be logged (${where}`,
    );
    expect(readFileSync(file, "utf8")).toBe(source);
    expect(reported).toEqual([]);
  });
});

describe("an op log with multibyte text", () => {
  it("takes the next write after a torn line that follows an entry with multibyte text", () => {
    writeFileSync(file, 'slot s : Text = ""\n');
    const first = replaceDef(file, "slot.s", 'Text = "あいう"').opId;
    const entries = logText();
    appendFileSync(logPath(), TORN);

    const second = replaceDef(file, "slot.s", 'Text = "x"', report).opId;

    expect(logText().startsWith(entries)).toBe(true);
    expect(logLines().map((e) => e["op-id"])).toEqual([first, second]);
    expect(reported).toEqual([at(2)]);
  });

  it("takes the next write after a torn line cut in the middle of a character", () => {
    const first = replaceDef(file, "slot.a", "Int = 1").opId;
    const entries = logText();
    const line = Buffer.from('{"op":"replace","layer":"slot","name":"s","body":"Text = \\"あ');
    // The first of the three bytes of あ.
    appendFileSync(logPath(), line.subarray(0, -2));

    const second = replaceDef(file, "slot.a", "Int = 7", report).opId;

    expect(logText().startsWith(entries)).toBe(true);
    expect(logLines().map((e) => e["op-id"])).toEqual([first, second]);
    expect(reported).toEqual([at(2)]);
  });
});

describe("patch apply and patch revert on an op log whose last line is torn", () => {
  /** A patch file holding `ops`, one per line. */
  const bundle = (...ops: object[]): string => {
    const p = join(dirname(file), "ops.jsonl");
    writeFileSync(p, `${ops.map((o) => JSON.stringify(o)).join("\n")}\n`);
    return p;
  };

  it("patch apply logs the bundle after the last complete entry", () => {
    const first = replaceDef(file, "slot.a", "Int = 1").opId;
    appendFileSync(logPath(), TORN);

    const ids = patchApplyFile(
      file,
      bundle(
        { op: "replace", layer: "slot", name: "a", body: "Int = 2" },
        { op: "add", layer: "slot", name: "b", body: "Int = 0" },
      ),
      report,
    );

    expect(readFileSync(file, "utf8")).toBe("slot a : Int = 2\n\nslot b : Int = 0\n");
    expect(logLines().map((e) => e["op-id"])).toEqual([first, ...ids]);
    // The bundle's first op cut the torn line off, so only it read one.
    expect(reported).toEqual([at(2)]);
  });

  it.each([
    ["add", { op: "add", layer: "slot", name: "b", body: "Int = 0" }],
    ["replace", { op: "replace", layer: "slot", name: "a", body: "Int = 2" }],
    ["edit", { op: "edit", layer: "slot", name: "a", patch: { find: "1", replace: "2" } }],
    ["rename", { op: "rename", layer: "slot", name: "a", newName: "z" }],
    ["remove", { op: "remove", layer: "slot", name: "a" }],
    [
      "cascade remove that lists what it removed",
      { op: "remove", layer: "slot", name: "a", cascade: true, removed: ["slot.a"] },
    ],
  ])("patch apply whose first op is %s hands the skipped line to onSkipped", (_, op) => {
    replaceDef(file, "slot.a", "Int = 1");
    appendFileSync(logPath(), TORN);

    patchApplyFile(file, bundle(op), report);

    expect(reported).toEqual([at(2)]);
  });

  it("patch apply whose later op fails puts back the file and the log, torn line and all", () => {
    replaceDef(file, "slot.a", "Int = 1");
    appendFileSync(logPath(), TORN);
    const before = { source: readFileSync(file, "utf8"), log: logText() };

    expect(() =>
      patchApplyFile(
        file,
        bundle(
          { op: "replace", layer: "slot", name: "a", body: "Int = 2" },
          { op: "add", layer: "tile", name: "Broken", body: "column(Nonexistent)" },
        ),
        report,
      ),
    ).toThrowError("patch apply rejected: add rejected: Validation failed");
    expect({ source: readFileSync(file, "utf8"), log: logText() }).toEqual(before);
    expect(before.log.endsWith(`\n${TORN}`)).toBe(true);
    // Only the bundle's first op read the log with the torn line on it.
    expect(reported).toEqual([at(2)]);
  });

  it("patch revert logs its op after the last complete entry", () => {
    const first = replaceDef(file, "slot.a", "Int = 1").opId;
    appendFileSync(logPath(), TORN);

    const revert = patchRevert(file, first, report);

    expect(readFileSync(file, "utf8")).toBe("slot a : Int = 0\n");
    expect(logLines().map((e) => e["op-id"])).toEqual([first, revert]);
    expect(reported).toEqual([at(2)]);
  });
});

describe("an op log whose last entry has no newline after it", () => {
  it("puts the next entry on a line of its own", () => {
    const first = replaceDef(file, "slot.a", "Int = 1").opId;
    writeFileSync(logPath(), logText().trimEnd());

    const second = replaceDef(file, "slot.a", "Int = 7", report).opId;

    expect(logLines().map((e) => e["op-id"])).toEqual([first, second]);
    expect(reported).toEqual([]);
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
    [
      "JSON that is not an object, with no newline after it",
      (good: string) => `${good}null`,
      2,
      "not an op object",
    ],
  ])("names the log and the line when it is %s", (_, layout, line, problem) => {
    replaceDef(file, "slot.a", "Int = 1");
    writeFileSync(logPath(), layout(logText()));
    const before = { source: readFileSync(file, "utf8"), log: logText() };
    const where = `${logPath()}:${line}: ${problem}`;

    expect(() => readOpLog(file, report)).toThrowError(where);
    expect(() => viewHistory(file, "slot.a", report)).toThrowError(where);
    expect(() => replaceDef(file, "slot.a", "Int = 7", report)).toThrowError(
      `replace rejected: the op could not be logged (${where}`,
    );
    expect({ source: readFileSync(file, "utf8"), log: logText() }).toEqual(before);
    expect(reported).toEqual([]);
  });
});

describe("the kumiki verbs on an op log whose last line is torn", () => {
  let first = "";
  beforeEach(() => {
    first = replaceDef(file, "slot.a", "Int = 1").opId;
    appendFileSync(logPath(), TORN);
  });

  it.each([
    ["add", () => ["add", file, "slot", "b", "Int = 0"], /^added slot\.b {2}\(op_\w+\)$/],
    ["replace", () => ["replace", file, "slot.a", "Int = 7"], /^replaced slot\.a {2}\(op_\w+\)$/],
    [
      "edit",
      () => ["edit", file, "slot.a", '{"find":"1","replace":"2"}'],
      /^edited slot\.a {2}\(op_\w+\)$/,
    ],
    ["rename", () => ["rename", file, "slot.a", "z"], /^renamed slot\.a -> z {2}\(op_\w+\)$/],
    ["remove", () => ["remove", file, "slot.a"], /^removed slot\.a {2}\(op_\w+\)$/],
    [
      "patch apply",
      () => {
        const ops = join(dirname(file), "ops.jsonl");
        writeFileSync(ops, '{"op":"add","layer":"slot","name":"b","body":"Int = 0"}\n');
        return ["patch", "apply", file, ops];
      },
      /^applied 1 ops: op_\w+$/,
    ],
    // It reads the log for the op to revert, and again to log the revert.
    ["patch revert", () => ["patch", "revert", file, first], /^reverted op_\w+ {2}\(op_\w+\)$/],
    [
      "view --history",
      () => ["view", file, "slot.a", "--history"],
      /^op_\w+ {2}\S+ {2}replace {2}by \S+$/,
    ],
  ])(
    "%s warns of the skipped line once on stderr, and answers on stdout",
    SPAWN,
    (_, args, stdout) => {
      const run = runCli(args());

      expect(run.stderr).toBe(`${warning(2)}\n`);
      expect(run.stdout.trimEnd()).toMatch(stdout);
      expect(run.code).toBe(0);
    },
  );

  it("warns before the error of a verb that then fails", SPAWN, () => {
    const run = runCli(["patch", "revert", file, "op_ON_THE_TORN_LINE"]);

    expect(run.stderr).toBe(
      `${warning(2)}\nError: patch revert: op-id "op_ON_THE_TORN_LINE" not found in log\n`,
    );
    expect(run.code).toBe(1);
  });

  it("says nothing of a log with no torn line", SPAWN, () => {
    writeFileSync(logPath(), logText().slice(0, -TORN.length));

    const run = runCli(["replace", file, "slot.a", "Int = 7"]);

    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
  });
});
