// Writing a `.kumiki` file (or one of its sidecars) so that no reader sees it
// half-written, and serializing the write verbs on one file across processes.

import { createHash, randomBytes } from "node:crypto";
// Every `fs` call goes through the namespace so tests can intercept it: a named
// import is resolved as a snapshot binding by Vitest's mock spread, defeating
// `vi.spyOn(fs, "writeFileSync")`, while property access on the namespace goes
// through the live slot on every call.
import * as fs from "node:fs";
import { hostname } from "node:os";
import { resolve as resolvePath } from "node:path";

/**
 * Replace `path` with `content` through a sibling temp file and a rename, so a
 * reader sees the old file or the new one and never a partial one, and a
 * throw at any step leaves `path` as it was. (`writeFileSync` on `path` itself
 * opens with `O_TRUNC`, so an ENOSPC partway leaves it truncated.) Every write
 * verb and `kumiki fix` write through it.
 *
 * The rename replaces the directory entry: on Windows libuv renames with
 * `MoveFileEx(MOVEFILE_REPLACE_EXISTING)`, and a reader holding the file open
 * does not block it, because libuv opens files with `FILE_SHARE_DELETE`. It
 * also means `path` is replaced, not written through — a symlink at `path` is
 * replaced by a regular file, and the file gets the temp file's default mode
 * rather than keeping its own.
 *
 * It writes what it is given and checks nothing; callers that need the content
 * to parse validate it first. `patch apply` restoring its pre-image on failure
 * is the one caller that does not, since that content was on disk before.
 */
export function atomicWriteFileSync(path: string, content: string): void {
  const tmp = `${path}.kumiki-write-${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, path);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Not created (the first write threw), or already renamed away. Either
      // way the failure worth reporting is `e`, not this one.
    }
    throw e;
  }
}

export function writeLockPath(path: string): string {
  return `${path}.kumiki-write.lock`;
}

/**
 * How long a write waits for other writers before it is rejected.
 *
 * A write op holds the lock across a few parses and typechecks of the file —
 * `patch apply` across every op in its bundle — and a waiter queues behind
 * every writer ahead of it, so K contenders wait about K holds. The default is
 * many times one op's hold. `KUMIKI_WRITE_LOCK_WAIT_MS` overrides it, read on
 * each call so a caller can change it after this module is loaded.
 */
function writeLockWaitMs(): number {
  const raw = Number(process.env.KUMIKI_WRITE_LOCK_WAIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

/**
 * How old a lock file that names no writer must be before it is taken over.
 * A writer creates the lock empty and fills it in with its next call, so an
 * empty or malformed lock younger than this may still be being written; one
 * older than this was left by a writer that died or failed in between.
 */
const UNREADABLE_LOCK_GRACE_MS = 2_000;

/** Errors from creating the lock that another attempt may not meet. */
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY", "EMFILE", "ENFILE"]);

/** The files this process holds the write lock on, with how deeply it is re-entered. */
const heldWriteLocks = new Map<string, number>();

type LockHolder = { pid: number; host: string };

/**
 * One lock file as it was seen: which file (device and inode), when it was
 * last written, and what it said. Two sightings are of the same lock only if
 * they are of the same file, unmodified, with the same content, so a lock removed and
 * created again in between is a different lock even if it names the same pid.
 */
export type LockSighting = {
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  content: string;
  holder: LockHolder | null;
};

type Look =
  | { kind: "gone" }
  | { kind: "unopenable"; code: string }
  | { kind: "seen"; lock: LockSighting };

/**
 * Run `fn` holding the write lock on `path`.
 *
 * Every write verb reads the file, composes a new one and appends to the op
 * log; two of them interleaving lose one's edit while both report success and
 * both log an op. The lock is a sibling file created with `wx`, so while it
 * exists no other writer can create it; the others wait for it, and give up
 * with an error — nothing written, nothing logged — if it is not released in
 * time. It is re-entrant within a process, because `patch apply` and
 * `patch revert` are made of the other verbs.
 *
 * A lock is taken over, not waited on, when its holder is known to be gone:
 * it names a process on this host that has exited, it names this process
 * (which holds nothing, so a release of its own failed), or it names no valid
 * writer and is older than a writer takes to fill it in. A holder on another
 * host is never presumed gone: its pid cannot be asked about from here.
 *
 * Releasing removes the lock only if it is still the one this call created, so
 * a lock deleted by hand and taken by another writer meanwhile is left alone.
 * A failure to remove it does not replace `fn`'s result or error.
 */
export function withWriteLock<T>(path: string, fn: () => T): T {
  const key = resolvePath(path);
  const depth = heldWriteLocks.get(key);
  if (depth !== undefined) {
    heldWriteLocks.set(key, depth + 1);
    try {
      return fn();
    } finally {
      heldWriteLocks.set(key, depth);
    }
  }
  const lock = writeLockPath(key);
  const mine = acquireWriteLock(key, lock);
  heldWriteLocks.set(key, 0);
  try {
    return fn();
  } finally {
    heldWriteLocks.delete(key);
    if (!claimLock(lock, mine)) {
      process.emitWarning(
        `kumiki left the write lock ${lock} in place: it could not be removed, or it is no longer the one this call created`,
      );
    }
  }
}

function acquireWriteLock(path: string, lock: string): LockSighting {
  const deadline = Date.now() + writeLockWaitMs();
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    let blocker: string;
    const created = tryCreateLock(lock);
    if (created.kind === "created") return created.lock;
    if (created.kind === "transient") {
      blocker = `${path} cannot be locked: creating ${lock} failed with ${created.code}`;
    } else {
      const look = lookAtLock(lock);
      if (look.kind === "gone") continue;
      if (look.kind === "unopenable") {
        blocker = `${path} cannot be locked: ${lock} cannot be read (${look.code})`;
      } else {
        if (isAbandoned(look.lock) && claimLock(lock, look.lock)) continue;
        blocker = describeHolder(path, look.lock, lock);
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`${blocker}; nothing was written. Try again.`);
    }
    Atomics.wait(nap, 0, 0, 5 + Math.floor(Math.random() * 20));
  }
}

type Created =
  | { kind: "created"; lock: LockSighting }
  | { kind: "exists" }
  | { kind: "transient"; code: string };

/**
 * Create the lock and fill it in. If filling it in fails, the file just
 * created is removed before the error propagates: an empty lock left behind
 * would hold every writer off until it aged past the grace period.
 */
function tryCreateLock(lock: string): Created {
  let fd: number;
  try {
    fd = fs.openSync(lock, "wx");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (code === "EEXIST") return { kind: "exists" };
    if (TRANSIENT.has(code)) return { kind: "transient", code };
    throw e;
  }
  const holder: LockHolder = { pid: process.pid, host: hostname() };
  const content = JSON.stringify({ ...holder, token: randomBytes(8).toString("hex") });
  let open = true;
  try {
    fs.writeSync(fd, content);
    const st = fs.fstatSync(fd, { bigint: true });
    fs.closeSync(fd);
    open = false;
    return {
      kind: "created",
      lock: { dev: st.dev, ino: st.ino, mtimeNs: st.mtimeNs, content, holder },
    };
  } catch (e) {
    if (open) {
      try {
        fs.closeSync(fd);
      } catch {
        // The write's error is the one to report.
      }
    }
    try {
      fs.unlinkSync(lock);
    } catch {
      // Already gone; nothing to clean up.
    }
    throw e;
  }
}

/** Read the lock through one descriptor, so its identity and content agree. */
function lookAtLock(lock: string): Look {
  let fd: number;
  try {
    fd = fs.openSync(lock, "r");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    return code === "ENOENT" ? { kind: "gone" } : { kind: "unopenable", code };
  }
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    const content = fs.readFileSync(fd, "utf8");
    return {
      kind: "seen",
      lock: {
        dev: st.dev,
        ino: st.ino,
        mtimeNs: st.mtimeNs,
        content,
        holder: parseHolder(content),
      },
    };
  } catch (e) {
    return { kind: "unopenable", code: (e as NodeJS.ErrnoException).code ?? String(e) };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The writer a lock names, or `null` when it names none: empty, not JSON, or a
 * pid that is not a process id (`0` and negative pids address process groups,
 * so asking whether they are alive answers about other processes).
 */
function parseHolder(content: string): LockHolder | null {
  try {
    const parsed = JSON.parse(content) as Partial<LockHolder>;
    return Number.isInteger(parsed.pid) &&
      (parsed.pid as number) > 0 &&
      typeof parsed.host === "string" &&
      parsed.host !== ""
      ? { pid: parsed.pid as number, host: parsed.host }
      : null;
  } catch {
    return null;
  }
}

function isAbandoned(seen: LockSighting): boolean {
  const { holder } = seen;
  if (holder === null) {
    const ageMs = Date.now() - Number(seen.mtimeNs / 1_000_000n);
    return ageMs > UNREADABLE_LOCK_GRACE_MS;
  }
  if (holder.host !== hostname()) return false;
  // This process holds no lock on this file (`withWriteLock` checked), so a
  // lock naming it was left by one of its own releases that failed.
  if (holder.pid === process.pid) return true;
  try {
    process.kill(holder.pid, 0);
    return false;
  } catch (e) {
    // EPERM means it exists but is not ours to signal: alive.
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function describeHolder(path: string, seen: LockSighting, lock: string): string {
  const { holder } = seen;
  if (holder === null) {
    return `${path} is locked by ${lock}, which names no writer; it is taken over once it is ${UNREADABLE_LOCK_GRACE_MS / 1000} s old`;
  }
  const here = holder.host === hostname();
  return (
    `${path} is being written by kumiki process ${holder.pid} on ${holder.host} (${lock})` +
    (here
      ? ""
      : `; whether it is still running cannot be checked from ${hostname()}, so if it is not, delete the lock file`)
  );
}

/**
 * Remove the lock at `lock` if it is still the one `seen` describes, and say
 * whether it was.
 *
 * Deleting by path would remove whatever lock is there by then: two waiters
 * that both saw a dead holder would each delete, and the second would delete
 * the lock the first had just created. Moving the lock aside to inspect it
 * does not help either: while a live lock is aside, a third writer can create
 * the lock, and the live one can then neither return nor be kept.
 *
 * So the lock itself is never touched until it is known to be the one seen.
 * A claim on that one sighting is a sibling file named after it and created
 * the way the lock is, so only one caller at a time can hold it. Holding it,
 * the caller looks at the lock again and deletes it only if it is still the
 * one seen. Nothing else can remove that lock meanwhile — its holder is gone,
 * or is this caller releasing its own, and every other remover would need the
 * same claim — and nothing can be created while it exists, so the lock looked
 * at is the lock deleted.
 *
 * A claim is held for a look and an unlink, and is then removed. One left by a
 * caller that stopped in between is judged like a lock (`isAbandoned`); a
 * caller that finds an abandoned claim moves on to the next claim name for
 * the same sighting rather than deleting it, so two callers never both
 * remove one and both proceed. A claim held by a live caller makes this call
 * report `false`, and a waiter looks again later.
 *
 * It never throws: a filesystem failure is reported as `false`, the lock left
 * as it was.
 */
export function claimLock(lock: string, seen: LockSighting): boolean {
  const base = `${lock}.takeover-${sightingKey(seen)}`;
  try {
    for (let gen = 0; ; ) {
      const claim = `${base}.${gen}`;
      const created = tryCreateLock(claim);
      if (created.kind === "transient") return false;
      if (created.kind === "exists") {
        const look = lookAtLock(claim);
        if (look.kind === "gone") continue;
        if (look.kind === "seen" && isAbandoned(look.lock)) {
          gen++;
          continue;
        }
        return false;
      }
      try {
        const now = lookAtLock(lock);
        if (now.kind !== "seen" || !sameLock(now.lock, seen)) return false;
        fs.unlinkSync(lock);
        // The claims abandoned before this one can no longer apply to anything.
        for (let g = 0; g < gen; g++) unlinkQuietly(`${base}.${g}`);
        return true;
      } finally {
        unlinkQuietly(claim);
      }
    }
  } catch {
    return false;
  }
}

/** A file name for one sighting, the same for every caller that saw it. */
function sightingKey(seen: LockSighting): string {
  return createHash("sha256")
    .update(`${seen.dev}:${seen.ino}:${seen.mtimeNs}:${seen.content}`)
    .digest("hex")
    .slice(0, 16);
}

function unlinkQuietly(path: string): void {
  try {
    fs.unlinkSync(path);
  } catch {
    // Already gone, or not removable now; a claim left over is abandoned and
    // its name is passed over.
  }
}

function sameLock(a: LockSighting, b: LockSighting): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mtimeNs === b.mtimeNs && a.content === b.content;
}
