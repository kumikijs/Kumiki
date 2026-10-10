import { existsSync, readFileSync } from "node:fs";
import { escapeRegExp } from "../text.ts";
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

/** Comma-separated globs, e.g. "slot.todos*,reducer.todo-*". `*` is the only wildcard. */
function patternToRegExp(pattern: string): RegExp {
  const reSrc = splitPatterns(pattern)
    .map((g) => g.split("*").map(escapeRegExp).join(".*"))
    .join("|");
  return new RegExp(`^(${reSrc})$`);
}

/**
 * Whether some name with exactly one dot, the shape of every qualified name, matches both globs.
 * The states still to visit are kept in a list rather than on the call stack, so globs of any
 * length are compared.
 */
function globsOverlap(a: string, b: string): boolean {
  // A name with a second dot is no qualified name, so `dots` is 0 or 1.
  const seen = new Set<number>();
  const todo: Array<[i: number, j: number, dots: number]> = [];
  const visit = (i: number, j: number, dots: number): void => {
    if (dots > 1) return;
    const key = (i * (b.length + 1) + j) * 2 + dots;
    if (seen.has(key)) return;
    seen.add(key);
    todo.push([i, j, dots]);
  };
  const spell = (c: string, dots: number): number => (c === "." ? dots + 1 : dots);
  visit(0, 0, 0);
  for (let state = todo.pop(); state !== undefined; state = todo.pop()) {
    const [i, j, dots] = state;
    const x = a[i];
    const y = b[j];
    if (x === undefined && y === undefined) {
      if (dots === 1) return true;
      continue;
    }
    if (x === "*") visit(i + 1, j, dots);
    if (y === "*") visit(i, j + 1, dots);
    if (x === "*" && y === "*") visit(i, j, dots + 1);
    else if (x === "*" && y !== undefined) visit(i, j + 1, spell(y, dots));
    else if (y === "*" && x !== undefined) visit(i + 1, j, spell(x, dots));
    else if (x !== undefined && x === y) visit(i + 1, j + 1, spell(x, dots));
  }
  return false;
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

// Refused, so that an agent has an entry in the lock file exactly when it holds a glob.
export function lockPatternProblem(pattern: string): string | undefined {
  if (splitPatterns(pattern).length > 0) return undefined;
  return `lock pattern "${pattern}" names no glob. Give one or more, comma-separated, like "slot.todos*,reducer.todo-*".`;
}

// Granting an overlapping glob would leave each agent refused by the other's lock on the names
// both match, so neither could edit them.
function lockConflict(
  locks: LockFile,
  agentId: string,
  globs: readonly string[],
): string | undefined {
  for (const glob of globs) {
    for (const e of locks.entries) {
      if (e.agent === agentId) continue;
      for (const pat of e.patterns) {
        if (splitPatterns(pat).some((held) => globsOverlap(glob, held))) {
          return `lock conflict: "${glob}" overlaps "${pat}", held by ${e.agent}. None of the request was granted: ${e.agent} has to unlock first, or ask for a glob that does not overlap "${pat}".`;
        }
      }
    }
  }
  return undefined;
}

export function lockDef(path: string, agentId: string, pattern: string): void {
  const problem = lockPatternProblem(pattern);
  if (problem !== undefined) throw new Error(problem);
  withWriteLock(path, () => {
    const locks = readLocks(path);
    const patterns = splitPatterns(pattern);
    const conflict = lockConflict(locks, agentId, patterns);
    if (conflict !== undefined) throw new Error(conflict);
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
    if (!locks.entries.some((e) => e.agent === agentId)) {
      // Named, so that a near miss (`agent-1` for `agent:1`) shows at once.
      const holders = locks.entries.map((e) => e.agent);
      const held =
        holders.length === 0
          ? "No agent holds one."
          : `Locks on it are held by ${holders.join(", ")}.`;
      throw new Error(`nothing to unlock: ${agentId} holds no lock on ${path}. ${held}`);
    }
    locks.entries = locks.entries.filter((e) => e.agent !== agentId);
    writeLocks(path, locks);
  });
}
