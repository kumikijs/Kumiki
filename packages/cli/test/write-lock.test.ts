// The write lock's own protocol, one step at a time: what a claim may remove,
// what a release may remove, and which filesystem failures it rides out.

import * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimLock, type LockSighting, withWriteLock, writeLockPath } from "../src/write-lock.ts";

// Spread `node:fs` into a plain object so `vi.spyOn(fs, …)` can replace its
// functions; native module namespaces are frozen.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual };
});

let dir = "";
let file = "";
let lock = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-write-lock-"));
  file = join(dir, "c.kumiki");
  lock = writeLockPath(file);
  writeFileSync(file, "");
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.KUMIKI_WRITE_LOCK_WAIT_MS;
  rmSync(dir, { recursive: true, force: true });
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
    expect(claimLock(lock, sight())).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("leaves in place a lock created after the one it saw was removed", () => {
    // Two waiters saw the same dead holder. The first removed it and created
    // its own lock; the second's claim, on what it saw, must not remove that.
    writeFileSync(lock, JSON.stringify({ pid: 999_999, host: hostname() }));
    const seen = sight();
    rmSync(lock);
    writeFileSync(lock, liveHolder);
    expect(claimLock(lock, seen)).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe(liveHolder);
  });

  it("never removes a lock it did not see, whatever another writer creates meanwhile", () => {
    // Waiters B and C both saw a dead holder; A has since taken its place and
    // holds the lock. B's claim, on what it saw, runs while C keeps trying to
    // create the lock before each of B's filesystem calls. As long as A's
    // lock stands, no attempt of C's can succeed, and A's lock must stand.
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
    expect(claimLock(lock, seen)).toBe(false);
    vi.restoreAllMocks();
    expect(cCreated).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe(liveHolder);
  });

  it("takes over a lock whose claim was left by a waiter that stopped, and leaves no claim behind", () => {
    writeFileSync(lock, JSON.stringify({ pid: 999_999, host: hostname() }));
    const seen = sight();
    // A first claim stops before it can remove anything: its files stay, naming
    // this process, which holds no claim once the call has returned.
    const stuck = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw errno("EBUSY");
    });
    expect(claimLock(lock, seen)).toBe(false);
    expect(fs.readdirSync(dir).length).toBeGreaterThan(2);
    stuck.mockRestore();
    expect(claimLock(lock, seen)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(["c.kumiki"]);
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
    process.env.KUMIKI_WRITE_LOCK_WAIT_MS = "2000";
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
    process.env.KUMIKI_WRITE_LOCK_WAIT_MS = "2000";
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
    process.env.KUMIKI_WRITE_LOCK_WAIT_MS = "200";
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
