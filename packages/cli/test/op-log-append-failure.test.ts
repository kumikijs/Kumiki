// @vitest-environment node
//
// A write op whose append to the op log fails. The source is put back either
// way, and the message says what the log holds afterwards: what it held before
// the op; its complete entries, when a skipped last line was cut off before the
// append; or possibly part of the op, when cutting the log back after the
// append failed too. In that last case the op has failed rather than been
// rejected, since the log may hold an op the file does not.
//
// `node:fs` is wrapped so that the op log's append fails partway, the way a
// full disk fails it, and the clean-up after it can fail too. Every other call,
// and every call on another path, goes to the real function. The file runs in
// the node environment because under happy-dom, Vitest does not route a
// module's named `node:fs` imports (mutate.ts's) through `vi.mock`.

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOpLog, replaceDef } from "@kumikijs/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  /** What lands of an op-log append before it fails; unset, appends go through. */
  lands: undefined as ((data: string) => string) | undefined,
  /** Cutting the op log back after the failed append fails too. */
  cutBack: false,
  /** Cutting a skipped last line off the op log fails. */
  cutOff: false,
  /** Putting the source back after the failed append fails too. */
  restore: false,
  /** An op-log append has failed. */
  failed: false,
}));

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const isLog = (p: unknown): boolean => String(p).endsWith(".kumiki-ops.jsonl");
  const error = (code: string, text: string, syscall: string, p?: unknown): Error =>
    Object.assign(
      new Error(`${code}: ${text}, ${syscall}${p === undefined ? "" : ` '${String(p)}'`}`),
      { code, syscall },
    );
  return {
    ...fs,
    appendFileSync: (...args: Parameters<typeof fs.appendFileSync>): void => {
      const [p, data] = args;
      if (fault.lands === undefined || !isLog(p)) {
        fs.appendFileSync(...args);
        return;
      }
      fs.appendFileSync(p, fault.lands(String(data)));
      fault.failed = true;
      throw error("ENOSPC", "no space left on device", "write");
    },
    truncateSync: (...args: Parameters<typeof fs.truncateSync>): void => {
      if (((fault.cutBack && fault.failed) || fault.cutOff) && isLog(args[0])) {
        throw error("EIO", "i/o error", "open", args[0]);
      }
      fs.truncateSync(...args);
    },
    rmSync: (...args: Parameters<typeof fs.rmSync>): void => {
      if (fault.cutBack && fault.failed && isLog(args[0])) {
        throw error("EIO", "i/o error", "rm", args[0]);
      }
      fs.rmSync(...args);
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>): void => {
      if (fault.restore && fault.failed && String(args[1]).endsWith(".kumiki")) {
        throw error("EIO", "i/o error", "rename", args[1]);
      }
      fs.renameSync(...args);
    },
  };
});

/** The start of an op-log line, cut off mid-key. */
const TORN = '{"op":"replace","layer":"slot","na';

const ENOSPC = "ENOSPC: no space left on device, write";

/** Half of the line lands. */
const half = (data: string): string => data.slice(0, Math.floor(data.length / 2));
/** All of the line lands but its newline. */
const allButNewline = (data: string): string => data.slice(0, -1);

let dir = "";
let file = "";
let log = "";
function reset(): void {
  fault.lands = undefined;
  fault.cutBack = false;
  fault.cutOff = false;
  fault.restore = false;
  fault.failed = false;
}
beforeEach(() => {
  reset();
  dir = mkdtempSync(join(tmpdir(), "kumiki-op-log-append-"));
  file = join(dir, "c.kumiki");
  log = `${file}.kumiki-ops.jsonl`;
  writeFileSync(file, "slot a : Int = 0\n");
});
afterEach(() => {
  reset();
  rmSync(dir, { recursive: true, force: true });
});

/** What the call threw. */
function errorOf(call: () => unknown): string {
  try {
    call();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "(nothing thrown)";
}

const readLog = (): string => readFileSync(log, "utf8");

/** The log as it stands before the failing op: one entry, then `tail`. */
function seed(tail: string): string {
  replaceDef(file, "slot.a", "Int = 1");
  const entries = readLog();
  appendFileSync(log, tail);
  return entries;
}

describe("an append to the op log that fails partway", () => {
  it("after a skipped last line was cut off says so, and leaves the complete entries", () => {
    const entries = seed(TORN);
    const source = readFileSync(file, "utf8");
    fault.lands = half;

    expect(errorOf(() => replaceDef(file, "slot.a", "Int = 7"))).toBe(
      `replace rejected: the op could not be logged (${ENOSPC}; ${log} holds its complete entries, and its skipped last line was cut off); the file was restored`,
    );
    expect(readFileSync(file, "utf8")).toBe(source);
    expect(readLog()).toBe(entries);
  });

  it.each([
    ["entries", false],
    ["entries, the last with no newline after it", true],
  ])("on a log of %s leaves it as it was and says nothing was written", (_, unterminated) => {
    replaceDef(file, "slot.a", "Int = 1");
    if (unterminated) writeFileSync(log, readLog().trimEnd());
    const before = { source: readFileSync(file, "utf8"), log: readLog() };
    fault.lands = half;

    expect(errorOf(() => replaceDef(file, "slot.a", "Int = 7"))).toBe(
      `replace rejected: the op could not be logged (${ENOSPC}); the file was restored and nothing was written`,
    );
    expect({ source: readFileSync(file, "utf8"), log: readLog() }).toEqual(before);
  });

  it("with no log removes the one it started and says nothing was written", () => {
    fault.lands = half;

    expect(errorOf(() => replaceDef(file, "slot.a", "Int = 7"))).toBe(
      `replace rejected: the op could not be logged (${ENOSPC}); the file was restored and nothing was written`,
    );
    expect(readFileSync(file, "utf8")).toBe("slot a : Int = 0\n");
    expect(() => readLog()).toThrowError(/ENOENT/);
  });
});

describe("a skipped last line that cannot be cut off the op log", () => {
  it("leaves the log as it was and says nothing was written", () => {
    seed(TORN);
    const before = { source: readFileSync(file, "utf8"), log: readLog() };
    fault.cutOff = true;

    expect(errorOf(() => replaceDef(file, "slot.a", "Int = 7"))).toBe(
      `replace rejected: the op could not be logged (EIO: i/o error, open '${log}'); the file was restored and nothing was written`,
    );
    expect({ source: readFileSync(file, "utf8"), log: readLog() }).toEqual(before);
  });
});

describe("an append to the op log that fails, when cutting the log back fails too", () => {
  it.each([
    ["entries", ""],
    ["entries and a skipped last line", TORN],
  ])("on a log of %s fails the op, naming the log and both errors", (_, tail) => {
    const entries = seed(tail);
    const source = readFileSync(file, "utf8");
    fault.lands = allButNewline;
    fault.cutBack = true;

    expect(errorOf(() => replaceDef(file, "slot.a", "Int = 7"))).toBe(
      `replace failed: the op could not be logged (${ENOSPC}; cutting ${log} back to its complete entries failed too (EIO: i/o error, open '${log}'), so its last line may hold part of this op); the file was restored`,
    );
    expect(readFileSync(file, "utf8")).toBe(source);
    // What the append wrote is still there: a whole entry with no newline
    // after it, which the next read takes for an op the file does not hold.
    expect(readLog().startsWith(entries)).toBe(true);
    expect(readOpLog(file)).toHaveLength(2);
  });

  it("with no log fails the op, naming the log and both errors", () => {
    fault.lands = allButNewline;
    fault.cutBack = true;

    expect(errorOf(() => replaceDef(file, "slot.a", "Int = 7"))).toBe(
      `replace failed: the op could not be logged (${ENOSPC}; removing ${log} failed too (EIO: i/o error, rm '${log}'), so its last line may hold part of this op); the file was restored`,
    );
    expect(readFileSync(file, "utf8")).toBe("slot a : Int = 0\n");
  });
});

describe("an append to the op log that fails, when putting the source back fails too", () => {
  it.each([
    [
      "the log was cut back",
      false,
      `${ENOSPC}), and restoring %file% failed too (EIO: i/o error, rename '%file%'); the file holds an edit the op log does not`,
    ],
    [
      "cutting the log back failed",
      true,
      `${ENOSPC}; cutting %log% back to its complete entries failed too (EIO: i/o error, open '%log%'), so its last line may hold part of this op), and restoring %file% failed too (EIO: i/o error, rename '%file%'); the file holds this op's edit`,
    ],
  ])("says what the file and the log hold when %s", (_, cutBack, rest) => {
    seed("");
    fault.lands = allButNewline;
    fault.cutBack = cutBack;
    fault.restore = true;

    expect(errorOf(() => replaceDef(file, "slot.a", "Int = 7"))).toBe(
      `replace failed: the op could not be logged (${rest.replaceAll("%file%", file).replaceAll("%log%", log)}`,
    );
  });
});
