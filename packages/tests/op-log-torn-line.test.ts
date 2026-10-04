// A write verb on a file whose op log ends in a torn line.
//
// Every write op reads the op log for its parent op before it appends its own
// entry. The log was parsed strictly, so a last line cut off mid-write (an
// append that never finished) made every later `add` / `replace` / `edit` /
// `remove` / `rename` exit 1 with a bare JSON `SyntaxError` — naming neither
// the log nor the line — and `view --history` fail the same way, until
// someone found and repaired the log by hand.
//
// The torn last line is skipped with a warning that names the log and the
// line, and the next op logged takes its place. A line that is not an op
// anywhere else still stops the verb, and the message says where it is.
//
// These run the CLI from source as a user would, because what is under test
// is the exit code and what the verb prints.

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cliDir = join(here, "..", "cli");
const TSX = pathToFileURL(createRequire(join(cliDir, "package.json")).resolve("tsx")).href;
const CLI = join(cliDir, "src", "kumiki.ts");

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

let dir = "";
let file = "";
let log = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-op-log-torn-"));
  file = join(dir, "c.kumiki");
  log = `${file}.kumiki-ops.jsonl`;
  writeFileSync(file, SOURCE);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function kumiki(...args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync(process.execPath, ["--import", TSX, CLI, ...args], {
    encoding: "utf8",
    timeout: 60_000,
  });
  // A process that never started or was killed has `status: null`; that must
  // not pass for an exit code.
  if (res.error) throw res.error;
  return { stdout: res.stdout, stderr: res.stderr, code: res.status ?? Number.NaN };
}

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
    const first = kumiki("replace", file, "slot.count", "Int = 1");
    expect(first.code).toBe(0);
    appendFileSync(log, TORN);
    const warning = `${log}:2: skipped the last line, which is not valid JSON and has no newline after it`;

    const history = kumiki("view", file, "slot.count", "--history");
    expect(history.stderr).toContain(warning);
    expect(history.code).toBe(0);
    expect(history.stdout).toContain(opId(first.stdout));

    const replace = kumiki("replace", file, "slot.count", "Int = 7");
    expect(replace.stderr).toContain(warning);
    expect(replace.code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("slot count : Int = 7");
    expect(loggedIds()).toEqual([opId(first.stdout), opId(replace.stdout)]);

    const add = kumiki("add", file, "slot", "extra", "Int = 0");
    expect(add.stderr).toBe("");
    expect(add.code).toBe(0);
    expect(loggedIds()).toEqual([opId(first.stdout), opId(replace.stdout), opId(add.stdout)]);
  });

  it("is warned about by a verb that then fails", { timeout: 120_000 }, () => {
    expect(kumiki("replace", file, "slot.count", "Int = 1").code).toBe(0);
    appendFileSync(log, TORN);

    // The op-id the user asks for may be the one on the torn line: the
    // warning is what says why it is not found.
    const revert = kumiki("patch", "revert", file, "op_ON_THE_TORN_LINE");
    expect(revert.code).toBe(1);
    expect(revert.stderr).toContain(`${log}:2: skipped the last line`);
    expect(revert.stderr).toContain("not found in log");
  });
});

describe("an op log with a line that is not an op before its last", () => {
  it("rejects a write with the file untouched and says which line", { timeout: 120_000 }, () => {
    expect(kumiki("replace", file, "slot.count", "Int = 1").code).toBe(0);
    writeFileSync(log, `${TORN}\n${readFileSync(log, "utf8")}`);
    const before = readFileSync(file, "utf8");

    const add = kumiki("add", file, "slot", "extra", "Int = 0");
    expect(add.code).toBe(1);
    expect(add.stderr).toContain(`${log}:1: not valid JSON`);
    expect(readFileSync(file, "utf8")).toBe(before);

    const history = kumiki("view", file, "slot.count", "--history");
    expect(history.code).toBe(1);
    expect(history.stderr).toContain(`${log}:1: not valid JSON`);
  });
});
