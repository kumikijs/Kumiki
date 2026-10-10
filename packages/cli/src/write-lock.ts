import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { hostname } from "node:os";
import { resolve as resolvePath } from "node:path";
import { threadId } from "node:worker_threads";

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
      // Not created (the first write threw), or already renamed away. Either way the failure worth reporting is `e`, not this one.
    }
    throw e;
  }
}

export function writeLockPath(path: string): string {
  return `${path}.kumiki-write.lock`;
}

function writeLockWaitMs(): number {
  const raw = Number(process.env.KUMIKI_WRITE_LOCK_WAIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

const UNREADABLE_LOCK_GRACE_MS = 2_000;

/** Errors from creating the lock that another attempt may not meet. */
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY", "EMFILE", "ENFILE"]);

const heldWriteLocks = new Map<string, number>();

type LockHolder = { pid: number; host: string; threadId: number };

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

function isOtherThread(holder: LockHolder): boolean {
  return holder.host === hostname() && holder.pid === process.pid && holder.threadId !== threadId;
}

/** `kumiki process <pid> on <host>`, and which thread when it is not the main one. */
function describeWriter(holder: LockHolder): string {
  const thread = holder.threadId === 0 ? "" : ` (thread ${holder.threadId})`;
  return `kumiki process ${holder.pid}${thread} on ${holder.host}`;
}

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

export type ClaimResult =
  | { kind: "removed" }
  | { kind: "changed" }
  | { kind: "claimed"; claim: string; by: LockSighting }
  | { kind: "failed"; file: string; code: string };

/**
 * Removes `lock` only while holding a claim on the sighting `seen`, and only if it is still that lock:
 * deleting by path lets a second waiter delete the lock the first just created, and moving it aside lets a
 * third writer create one meanwhile. An abandoned claim is passed over to the next generation rather than
 * deleted by whoever finds it, so two callers cannot both remove it and both proceed.
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
    // Already gone, or not removable now. A claim left over is judged like a lock: only once the process that left it has exited is it abandoned and its name passed over.
  }
}

function sameLock(a: LockSighting, b: LockSighting): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mtimeNs === b.mtimeNs && a.content === b.content;
}
