// Writing a `.kumiki` file (or one of its sidecars) so that no reader sees it
// half-written, and serializing the write verbs on one file across processes
// and across the worker threads of one process.

import { createHash, randomBytes } from "node:crypto";
// Every `fs` call goes through the namespace so tests can intercept it: a named
// import is resolved as a snapshot binding by Vitest's mock spread, defeating
// `vi.spyOn(fs, "writeFileSync")`, while property access on the namespace goes
// through the live slot on every call.
import * as fs from "node:fs";
import { hostname } from "node:os";
import { resolve as resolvePath } from "node:path";
import { threadId } from "node:worker_threads";

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
  // Named for the thread, not just the process: worker threads share a pid.
  const tmp = `${path}.kumiki-write-${process.pid}-${threadId}.tmp`;
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

/**
 * The files this thread holds the write lock on, with how deeply it is
 * re-entered. Each worker thread loads its own copy of this module, so the map
 * says nothing about other threads of the process.
 */
const heldWriteLocks = new Map<string, number>();

/**
 * The writer a lock names. `threadId` is `node:worker_threads`' id of the
 * writing thread (0 for the main thread), since every thread of a process
 * shares its pid.
 */
type LockHolder = { pid: number; host: string; threadId: number };

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
 * time. It is re-entrant within a thread, because `patch apply` and
 * `patch revert` are made of the other verbs.
 *
 * A lock is taken over, not waited on, when its holder is known to be gone:
 * it names a process on this host that has exited, it names this thread
 * (which holds nothing, so a release of its own failed), or it names no valid
 * writer and is older than a writer takes to fill it in. A lock naming another
 * thread of this process is live, like any running process's. A holder on
 * another host is never presumed gone: its pid cannot be asked about from here.
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
    if (claimLock(lock, mine).kind !== "removed") {
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
        const claim = isAbandoned(look.lock) ? claimLock(lock, look.lock) : null;
        if (claim?.kind === "removed") continue;
        blocker =
          claim?.kind === "claimed"
            ? describeClaim(path, lock, claim.claim, claim.by)
            : claim?.kind === "failed"
              ? `${path} cannot be locked: ${lock} was left by a writer that is gone, and taking it over failed on ${claim.file} (${claim.code})`
              : describeHolder(path, look.lock, lock);
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
  const holder: LockHolder = { pid: process.pid, host: hostname(), threadId };
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
 * The writer a lock names, or `null` when it names none: empty, not JSON, a
 * pid that is not a process id (`0` and negative pids address process groups,
 * so asking whether they are alive answers about other processes), or a
 * `threadId` that is not a thread id. A lock with no `threadId`, written
 * before it was recorded, names the main thread.
 */
function parseHolder(content: string): LockHolder | null {
  try {
    const parsed = JSON.parse(content) as Partial<LockHolder>;
    const thread = parsed.threadId === undefined ? 0 : parsed.threadId;
    return Number.isInteger(parsed.pid) &&
      (parsed.pid as number) > 0 &&
      typeof parsed.host === "string" &&
      parsed.host !== "" &&
      Number.isInteger(thread) &&
      thread >= 0
      ? { pid: parsed.pid as number, host: parsed.host, threadId: thread }
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
  // This thread holds no lock on this file (`withWriteLock` checked), so a
  // lock naming it was left by one of its own releases that failed. A lock
  // naming another thread of this process is held by a running process.
  if (holder.pid === process.pid) return holder.threadId === threadId;
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
  return (
    `${path} is being written by ${describeWriter(holder)} (${lock})` +
    (holder.host !== hostname()
      ? `; whether it is still running cannot be checked from ${hostname()}, so if it is not, delete the lock file`
      : isOtherThread(holder)
        ? "; it is waited on until this process exits, so if that thread is not writing this file, delete the lock file"
        : "")
  );
}

/**
 * Whether `holder` is another thread of this process. Whether a thread is
 * still running cannot be asked from another thread, so its lock is waited on
 * until the process exits, even when the thread ended mid-write.
 */
function isOtherThread(holder: LockHolder): boolean {
  return holder.host === hostname() && holder.pid === process.pid && holder.threadId !== threadId;
}

/** `kumiki process <pid> on <host>`, and which thread when it is not the main one. */
function describeWriter(holder: LockHolder): string {
  const thread = holder.threadId === 0 ? "" : ` (thread ${holder.threadId})`;
  return `kumiki process ${holder.pid}${thread} on ${holder.host}`;
}

/**
 * Why a lock that is gone is still in the way: another caller holds the claim
 * to take it over. The claim, not the lock, is the file to act on.
 */
function describeClaim(path: string, lock: string, claim: string, by: LockSighting): string {
  const why = `${path} cannot be locked: ${lock} was left by a writer that is gone, and ${claim}, a claim to take it over,`;
  const { holder } = by;
  if (holder === null) {
    return `${why} names no writer; it is passed over once it is ${UNREADABLE_LOCK_GRACE_MS / 1000} s old`;
  }
  return (
    `${why} is held by ${describeWriter(holder)}` +
    (holder.host !== hostname()
      ? `; whether it is still running cannot be checked from ${hostname()}, so if it is not, delete the claim file`
      : isOtherThread(holder)
        ? "; it is passed over once this process exits, so if that thread is not writing this file, delete the claim file"
        : "; it is passed over once that process exits, so if that process is not writing this file, stop it or delete the claim file")
  );
}

/**
 * What `claimLock` did: removed the lock; found it no longer the one seen (or
 * gone); backed off because another caller holds the claim on that sighting
 * (`claim` is that file, `by` what it said); or failed on a filesystem call,
 * leaving the lock as it was.
 */
export type ClaimResult =
  | { kind: "removed" }
  | { kind: "changed" }
  | { kind: "claimed"; claim: string; by: LockSighting }
  | { kind: "failed"; file: string; code: string };

/**
 * Remove the lock at `lock` if it is still the one `seen` describes, and say
 * what happened.
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
 * or it is this caller releasing its own, and every other remover would need the
 * same claim — and nothing can be created while it exists, so the lock looked
 * at is the lock deleted.
 *
 * A claim is held for a look and an unlink, and is then removed. One left by a
 * caller that stopped in between is judged like a lock (`isAbandoned`); a
 * caller that finds an abandoned claim moves on to the next claim name for
 * the same sighting rather than deleting it, so two callers never both
 * remove one and both proceed. A claim held by a live caller makes this call
 * back off (`claimed`, naming that claim), and a waiter looks again later.
 *
 * It never throws: a filesystem failure is reported as `failed`, the lock left
 * as it was.
 */
export function claimLock(lock: string, seen: LockSighting): ClaimResult {
  const base = `${lock}.takeover-${sightingKey(seen)}`;
  let file = base;
  try {
    for (let gen = 0; ; ) {
      const claim = `${base}.${gen}`;
      file = claim;
      const created = tryCreateLock(claim);
      if (created.kind === "transient") return { kind: "failed", file, code: created.code };
      if (created.kind === "exists") {
        const look = lookAtLock(claim);
        if (look.kind === "gone") continue;
        if (look.kind === "unopenable") return { kind: "failed", file, code: look.code };
        if (isAbandoned(look.lock)) {
          gen++;
          continue;
        }
        return { kind: "claimed", claim, by: look.lock };
      }
      try {
        file = lock;
        const now = lookAtLock(lock);
        if (now.kind !== "seen" || !sameLock(now.lock, seen)) return { kind: "changed" };
        fs.unlinkSync(lock);
        // The claims abandoned before this one can no longer apply to anything.
        for (let g = 0; g < gen; g++) unlinkQuietly(`${base}.${g}`);
        return { kind: "removed" };
      } finally {
        unlinkQuietly(claim);
      }
    }
  } catch (e) {
    return { kind: "failed", file, code: (e as NodeJS.ErrnoException).code ?? String(e) };
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
    // Already gone, or not removable now. A claim left over is judged like a
    // lock: only once the process that left it has exited is it abandoned and
    // its name passed over. Until then — a long-running process such as the
    // MCP server — it holds off every other caller's takeover of that lock,
    // other threads of its own process included, until the thread that left
    // it claims again and passes over it.
  }
}

function sameLock(a: LockSighting, b: LockSighting): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mtimeNs === b.mtimeNs && a.content === b.content;
}
