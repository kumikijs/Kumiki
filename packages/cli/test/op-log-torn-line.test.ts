import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli.ts";
import { seed } from "./helpers/files.ts";
import { logPath } from "./helpers/op-log.ts";

const SOURCE = `slot count : Int = 0

reducer inc on=ui.click(IncBtn) do= count := count + 1

tile IncBtn = button(text="+")
tile App = column(heading("Count: " + count), IncBtn)

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** The start of an op-log line, cut off mid-key. */
const TORN = '{"op":"replace","layer":"slot","na';

let file = "";
let log = "";
beforeEach(() => {
  file = seed(SOURCE, "c.kumiki");
  log = logPath(file);
});

/** The op-ids of the log's lines, each line parsed on its own. */
function loggedIds(): string[] {
  const text = readFileSync(log, "utf8");
  expect(text.endsWith("\n")).toBe(true);
  return text
    .slice(0, -1)
    .split("\n")
    .map((line) => (JSON.parse(line) as { "op-id": string })["op-id"]);
}

const opId = (stdout: string): string => /\((op_\w+)\)/.exec(stdout)?.[1] ?? "(no op-id)";

describe("an op log that ends in a torn line", () => {
  it("is listed by view --history and written past by the next op", { timeout: 120_000 }, () => {
    const first = runCli(["replace", file, "slot.count", "Int = 1"]);
    expect(first.code).toBe(0);
    appendFileSync(log, TORN);
    const warning = `${log}:2: skipped the last line, which is not valid JSON and has no newline after it`;

    const history = runCli(["view", file, "slot.count", "--history"]);
    expect(history.stderr).toContain(warning);
    expect(history.code).toBe(0);
    expect(history.stdout).toContain(opId(first.stdout));

    const replace = runCli(["replace", file, "slot.count", "Int = 7"]);
    expect(replace.stderr).toContain(warning);
    expect(replace.code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("slot count : Int = 7");
    expect(loggedIds()).toEqual([opId(first.stdout), opId(replace.stdout)]);

    const add = runCli(["add", file, "slot", "extra", "Int = 0"]);
    expect(add.stderr).not.toContain("skipped the last line");
    expect(add.code).toBe(0);
    expect(loggedIds()).toEqual([opId(first.stdout), opId(replace.stdout), opId(add.stdout)]);
  });

  it("is warned about by a verb that then fails", { timeout: 120_000 }, () => {
    expect(runCli(["replace", file, "slot.count", "Int = 1"]).code).toBe(0);
    appendFileSync(log, TORN);

    // The op-id asked for may be the one on the torn line: the warning is what says why it is not found.
    const revert = runCli(["patch", "revert", file, "op_ON_THE_TORN_LINE"]);
    expect(revert.code).toBe(1);
    expect(revert.stderr).toContain(`${log}:2: skipped the last line`);
    expect(revert.stderr).toContain("not found in log");
  });
});

describe("an op log with a line that is not an op before its last", () => {
  it("rejects a write with the file untouched and says which line", { timeout: 120_000 }, () => {
    expect(runCli(["replace", file, "slot.count", "Int = 1"]).code).toBe(0);
    writeFileSync(log, `${TORN}\n${readFileSync(log, "utf8")}`);
    const before = readFileSync(file, "utf8");

    const add = runCli(["add", file, "slot", "extra", "Int = 0"]);
    expect(add.code).toBe(1);
    expect(add.stderr).toContain(`${log}:1: not valid JSON`);
    expect(readFileSync(file, "utf8")).toBe(before);

    const history = runCli(["view", file, "slot.count", "--history"]);
    expect(history.code).toBe(1);
    expect(history.stderr).toContain(`${log}:1: not valid JSON`);
  });
});
