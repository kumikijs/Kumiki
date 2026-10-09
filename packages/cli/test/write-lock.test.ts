import * as fs from "node:fs";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { threadId } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimLock, type LockSighting, withWriteLock, writeLockPath } from "../src/write-lock.ts";
import { tempDir } from "./helpers/files.ts";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual };
});

let file = "";
let lock = "";
beforeEach(() => {
  file = join(tempDir(), "c.kumiki");
  lock = writeLockPath(file);
  writeFileSync(file, "");
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The lock file as it stands now. */
function sight(): LockSighting {
  const st = fs.statSync(lock, { bigint: true });
  return {
    dev: st.dev,
    ino: st.ino,
    mtimeNs: st.mtimeNs,
    content: readFileSync(lock, "utf8"),
    holder: null,
  };
}

const errno = (code: string): Error => Object.assign(new Error(`${code}: simulated`), { code });

/** A holder that is alive for as long as this test runs: the test runner's parent. */
const liveHolder = JSON.stringify({ pid: process.ppid, host: hostname() });

describe("claiming a lock", () => {
  it("removes the lock it saw", () => {
    writeFileSync(lock, JSON.stringify({ pid: 999_999, host: hostname() }));
    expect(claimLock(lock, sight())).toEqual({ kind: "removed" });
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("leaves in place a lock created after the one it saw was removed", () => {
    writeFileSync(lock, JSON.stringify({ pid: 999_999, host: hostname() }));
    const seen = sight();
    rmSync(lock);
    writeFileSync(lock, liveHolder);
    expect(claimLock(lock, seen)).toEqual({ kind: "changed" });
    expect(readFileSync(lock, "utf8")).toBe(liveHolder);
  });

  it("never removes a lock it did not see, whatever another writer creates meanwhile", () => {
    writeFileSync(lock, JSON.stringify({ pid: 999_999, host: hostname() }));
    const seen = sight();
    rmSync(lock);
    writeFileSync(lock, liveHolder);
    const real = { ...fs };
    let inC = false;
    let cCreated = false;
    const cTries = (): void => {
      if (inC) return;
      inC = true;
      try {
        real.closeSync(real.openSync(lock, "wx"));
        cCreated = true;
      } catch {
        // A lock is there: C waits.
      } finally {
        inC = false;
      }
    };
    for (const name of [
      "openSync",
      "readFileSync",
      "fstatSync",
      "closeSync",
      "writeSync",
      "renameSync",
      "linkSync",
      "unlinkSync",
    ] as const) {
      const original = real[name] as (...args: unknown[]) => unknown;
      vi.spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
        cTries();
        return original(...args);
      }) as never);
    }
    expect(claimLock(lock, seen)).toEqual({ kind: "changed" });
    vi.restoreAllMocks();
    expect(cCreated).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe(liveHolder);
  });

  it("takes over a lock whose claim was left by a waiter that stopped, and leaves no claim behind", () => {
    writeFileSync(lock, JSON.stringify({ pid: 999_999, host: hostname() }));
    const seen = sight();
    const stuck = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw errno("EBUSY");
    });
    expect(claimLock(lock, seen)).toMatchObject({ kind: "failed", code: "EBUSY" });
    expect(fs.readdirSync(dirname(file)).length).toBeGreaterThan(2);
    stuck.mockRestore();
    expect(claimLock(lock, seen)).toEqual({ kind: "removed" });
    expect(fs.readdirSync(dirname(file))).toEqual(["c.kumiki"]);
  });

  it("a claim held by a live caller makes the claimer back off and leaves the lock", () => {
    const dead = JSON.stringify({ pid: 999_999, host: hostname() });
    writeFileSync(lock, dead);
    const seen = sight();
    const claim = leaveClaim(seen);
    writeFileSync(claim, liveHolder);
    expect(claimLock(lock, seen)).toMatchObject({
      kind: "claimed",
      claim,
      by: { holder: { pid: process.ppid, host: hostname() } },
    });
    expect(readFileSync(lock, "utf8")).toBe(dead);
    expect(readFileSync(claim, "utf8")).toBe(liveHolder);
  });

  it("a claim that names no writer yet, younger than the grace period, makes the claimer back off", () => {
    const dead = JSON.stringify({ pid: 999_999, host: hostname() });
    writeFileSync(lock, dead);
    const seen = sight();
    const claim = leaveClaim(seen);
    writeFileSync(claim, "");
    expect(claimLock(lock, seen)).toMatchObject({ kind: "claimed", claim, by: { holder: null } });
    expect(readFileSync(lock, "utf8")).toBe(dead);
  });
});

function leaveClaim(seen: LockSighting): string {
  const stuck = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
    throw errno("EBUSY");
  });
  claimLock(lock, seen);
  stuck.mockRestore();
  const claims = fs.readdirSync(dirname(file)).filter((name) => name.includes(".takeover-"));
  expect(claims).toHaveLength(1);
  return join(dirname(file), claims[0] as string);
}

describe("waiting on a lock that is being taken over", () => {
  it("names the claim that holds the takeover, and its holder, when the wait runs out", () => {
    vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "200");
    writeFileSync(lock, JSON.stringify({ pid: 999_999, host: hostname() }));
    const claim = leaveClaim(sight());
    writeFileSync(claim, liveHolder);
    const ran = vi.fn();
    expect(() => withWriteLock(file, ran)).toThrow(
      `${claim}, a claim to take it over, is held by kumiki process ${process.ppid} on ${hostname()}`,
    );
    expect(ran).not.toHaveBeenCalled();
  });
});

describe("a claim held by another thread of this process", () => {
  it("makes the claimer back off, and the wait-out message names the thread", () => {
    vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "200");
    const dead = JSON.stringify({ pid: 999_999, host: hostname() });
    writeFileSync(lock, dead);
    const seen = sight();
    const claim = leaveClaim(seen);
    const other = JSON.stringify({ pid: process.pid, host: hostname(), threadId: threadId + 1 });
    writeFileSync(claim, other);
    expect(claimLock(lock, seen)).toMatchObject({
      kind: "claimed",
      claim,
      by: { holder: { pid: process.pid, threadId: threadId + 1 } },
    });
    expect(() => withWriteLock(file, () => "done")).toThrow(
      `${claim}, a claim to take it over, is held by kumiki process ${process.pid} (thread ${threadId + 1}) on ${hostname()}; it is passed over once this process exits, so if that thread is not writing this file, delete the claim file`,
    );
    expect(readFileSync(lock, "utf8")).toBe(dead);
    expect(readFileSync(claim, "utf8")).toBe(other);
  });
});

describe("releasing the lock", () => {
  it("leaves a lock that is no longer the one this call created", () => {
    // Someone deleted the lock by hand mid-write and another writer took it.
    withWriteLock(file, () => {
      rmSync(lock);
      writeFileSync(lock, liveHolder);
    });
    expect(readFileSync(lock, "utf8")).toBe(liveHolder);
  });

  it("returns the result even when the lock cannot be removed, and the next write proceeds", () => {
    vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "2000");
    const unlink = fs.unlinkSync;
    const stuck = vi.spyOn(fs, "unlinkSync").mockImplementation((path) => {
      if (String(path) === lock) throw errno("EBUSY");
      unlink(path);
    });
    vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    expect(withWriteLock(file, () => 42)).toBe(42);
    expect(fs.existsSync(lock)).toBe(true);
    stuck.mockRestore();
    // The lock left behind names this process, which holds nothing: taken over.
    expect(withWriteLock(file, () => 43)).toBe(43);
    expect(fs.existsSync(lock)).toBe(false);
    expect(fs.readdirSync(dirname(file))).toEqual(["c.kumiki"]);
  });
});

describe("a lock naming this process", () => {
  it("is taken over when it names this thread, which holds nothing", () => {
    vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "2000");
    writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), threadId }));
    expect(withWriteLock(file, () => "done")).toBe("done");
    expect(fs.existsSync(lock)).toBe(false);
  });

  it.runIf(threadId === 0)(
    "is taken over when it names no thread, as written before threads were recorded, on the main thread",
    () => {
      vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "2000");
      writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname() }));
      expect(withWriteLock(file, () => "done")).toBe("done");
      expect(fs.existsSync(lock)).toBe(false);
    },
  );

  it("is waited on when it names another thread, which is running", () => {
    vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "200");
    const other = JSON.stringify({ pid: process.pid, host: hostname(), threadId: threadId + 1 });
    writeFileSync(lock, other);
    expect(() => withWriteLock(file, () => "done")).toThrow(
      `is being written by kumiki process ${process.pid} (thread ${threadId + 1}) on ${hostname()} (${lock}); it is waited on until this process exits, so if that thread is not writing this file, delete the lock file`,
    );
    expect(readFileSync(lock, "utf8")).toBe(other);
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["not a number", "1"],
    ["null", null],
  ])("names no writer when its thread is %s", (_, bad) => {
    vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "200");
    writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), threadId: bad }));
    expect(() => withWriteLock(file, () => "done")).toThrow("which names no writer");
  });
});

describe("acquiring the lock", () => {
  it.each([
    "EPERM",
    "EACCES",
    "EBUSY",
    "EMFILE",
    "ENFILE",
  ])("retries a create that fails with %s", (code) => {
    vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "2000");
    const open = fs.openSync;
    let failures = 3;
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (String(path) === lock && flags === "wx" && failures-- > 0) throw errno(code);
      return open(path, flags, mode);
    });
    expect(withWriteLock(file, () => "done")).toBe("done");
    expect(failures).toBeLessThan(0);
  });

  it("names the error when a create keeps failing past the deadline", () => {
    vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "200");
    const open = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (String(path) === lock && flags === "wx") throw errno("EMFILE");
      return open(path, flags, mode);
    });
    expect(() => withWriteLock(file, () => "done")).toThrow(
      `creating ${lock} failed with EMFILE; nothing was written`,
    );
  });

  it("does not leave an empty lock behind when filling it in fails", () => {
    vi.spyOn(fs, "writeSync").mockImplementation(() => {
      throw errno("ENOSPC");
    });
    const ran = vi.fn();
    expect(() => withWriteLock(file, ran)).toThrow("ENOSPC");
    expect(ran).not.toHaveBeenCalled();
    expect(fs.existsSync(lock)).toBe(false);
  });
});
