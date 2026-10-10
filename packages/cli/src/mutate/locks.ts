import { existsSync, readFileSync } from "node:fs";
import { atomicWriteFileSync, withWriteLock } from "../write-lock.ts";
import { authorOf } from "./op-log.ts";

type LockFile = { entries: Array<{ agent: string; patterns: string[] }> };

function lockPath(path: string): string {
  return `${path}.kumiki-locks.json`;
}

function readLocks(path: string): LockFile {
  const p = lockPath(path);
  if (!existsSync(p)) return { entries: [] };
  return JSON.parse(readFileSync(p, "utf8")) as LockFile;
}

function writeLocks(path: string, locks: LockFile): void {
  // By rename: `enforceLock` reads this file without the write lock.
  atomicWriteFileSync(lockPath(path), `${JSON.stringify(locks, null, 2)}\n`);
}

function splitPatterns(pattern: string): string[] {
  return pattern
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Comma-separated globs, e.g. "slot.todos*,reducer.todo-*". */
function patternToRegExp(pattern: string): RegExp {
  const reSrc = splitPatterns(pattern)
    .map((g) => g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"))
    .join("|");
  return new RegExp(`^(${reSrc})$`);
}

export function lockViolation(path: string, qnames: readonly string[]): string | undefined {
  const locks = readLocks(path);
  if (locks.entries.length === 0) return undefined;
  const me = authorOf();
  for (const qname of qnames) {
    for (const e of locks.entries) {
      if (e.agent === me) continue;
      for (const pat of e.patterns) {
        if (patternToRegExp(pat).test(qname)) {
          return `lock violation: ${qname} is locked by ${e.agent} (pattern "${pat}"). Set KUMIKI_AUTHOR=${e.agent} to edit.`;
        }
      }
    }
  }
  return undefined;
}

export function enforceLock(path: string, qname: string): void {
  const locked = lockViolation(path, [qname]);
  if (locked !== undefined) throw new Error(locked);
}

export function lockDef(path: string, agentId: string, pattern: string): void {
  withWriteLock(path, () => {
    const locks = readLocks(path);
    const patterns = splitPatterns(pattern);
    const existing = locks.entries.find((e) => e.agent === agentId);
    if (existing) {
      for (const p of patterns) if (!existing.patterns.includes(p)) existing.patterns.push(p);
    } else {
      locks.entries.push({ agent: agentId, patterns });
    }
    writeLocks(path, locks);
  });
}

export function unlockDef(path: string, agentId: string): void {
  withWriteLock(path, () => {
    const locks = readLocks(path);
    locks.entries = locks.entries.filter((e) => e.agent !== agentId);
    writeLocks(path, locks);
  });
}
