// Mutating commands for the kumiki CLI. Each mutation rewrites the .kumiki
// file and appends an entry to `<file>.kumiki-ops.jsonl`.

import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { resolve as resolvePath } from "node:path";
import { check, lex, type Pos, parse } from "@kumikijs/compiler";
import {
  type DefEntry,
  directDeps,
  findReferences,
  load,
  referenceSites,
  type Store,
} from "./store.ts";

// Crockford base32. The mutate-op id is a §9.3.3 ULID — 10-char ms timestamp
// prefix followed by 16 random chars — so that lexicographic ordering matches
// time order. §9.3.3 decides same-name add winners by op-id lexicographic
// order; without the time prefix the tie-break would be random.
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number): string {
  let s = "";
  let n = ms;
  for (let i = 0; i < 10; i++) {
    s = ULID_ALPHABET[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
}

/** Generate a ULID-shape id with the given prefix. */
export function newId(prefix: string): string {
  const ts = encodeTime(Date.now());
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ULID_ALPHABET[Math.floor(Math.random() * 32)];
  return `${prefix}_${ts}${rand}`;
}

export type OpLogEntry = {
  op: string;
  layer: string;
  name: string;
  body?: string;
  newName?: string;
  cascade?: boolean;
  /** Every definition a cascade deleted, the requested one first (§9.4.1). */
  removed?: string[];
  patch?: unknown;
  author: string;
  ts: number;
  "op-id": string;
  "parent-ops": string[];
  "depends-on": string[];
};

type RawOp = {
  op: string;
  layer: string;
  name: string;
  body?: string;
  newName?: string;
  cascade?: boolean;
  removed?: string[];
  patch?: unknown;
};

function opLogPath(path: string): string {
  return `${path}.kumiki-ops.jsonl`;
}

function lockPath(path: string): string {
  return `${path}.kumiki-locks.json`;
}

function episodeLogPath(path: string): string {
  return `${path}.kumiki-episodes.jsonl`;
}

function authorOf(): string {
  return process.env.KUMIKI_AUTHOR || "agent:local";
}

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export function readOpLog(path: string): OpLogEntry[] {
  const p = opLogPath(path);
  if (!existsSync(p)) return [];
  const text = readFileSync(p, "utf8");
  const out: OpLogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as OpLogEntry);
  }
  return out;
}

function lastOpId(path: string): string | undefined {
  const log = readOpLog(path);
  return log.at(-1)?.["op-id"];
}

/**
 * Compute the `depends-on` list for an op. The body is scanned for identifiers
 * matching other definitions; each match contributes `<layer>:<name>@h:<hash>`
 * where the hash is the §9.5.1 transitive content hash (same algorithm as
 * `viewHash`), so `view --hash <q>` of any dependency is directly comparable
 * to the `@h:` digest recorded here. Falls back to the raw body identifiers
 * when the file has not yet parsed (e.g. mid-rollback).
 */
function computeDependsOn(path: string, layer: string, name: string, body: string): string[] {
  try {
    const store = load(path);
    const qname = `${layer}.${name}`;
    const deps = store.byQName.has(qname)
      ? directDeps(store, qname)
      : depsFromBody(store, body, name);
    const memo = new Map<string, string>();
    return deps
      .map((q) => {
        const entry = store.byQName.get(q);
        if (!entry) return null;
        return `${entry.layer}:${entry.name}@h:${computeHash(store, q, memo)}`;
      })
      .filter((s): s is string => s !== null)
      .sort();
  } catch {
    return [];
  }
}

function depsFromBody(store: Store, body: string, selfName: string): string[] {
  const refs = new Set<string>();
  for (const m of body.matchAll(/[a-zA-Z_][a-zA-Z0-9_-]*/g)) {
    const tok = m[0];
    if (!tok || tok === selfName) continue;
    for (const other of store.defs) {
      if (other.name === tok) refs.add(`${other.layer}.${other.name}`);
    }
  }
  return [...refs].sort();
}

function logOp(path: string, op: RawOp): string {
  const id = newId("op");
  const parents = lastOpId(path);
  const dependsOn = op.body !== undefined ? computeDependsOn(path, op.layer, op.name, op.body) : [];
  const entry: OpLogEntry = {
    op: op.op,
    layer: op.layer,
    name: op.name,
    ...(op.body !== undefined ? { body: op.body } : {}),
    ...(op.newName !== undefined ? { newName: op.newName } : {}),
    ...(op.cascade !== undefined ? { cascade: op.cascade } : {}),
    ...(op.removed !== undefined ? { removed: op.removed } : {}),
    ...(op.patch !== undefined ? { patch: op.patch } : {}),
    author: authorOf(),
    ts: Date.now(),
    "op-id": id,
    "parent-ops": parents ? [parents] : [],
    "depends-on": dependsOn,
  };
  appendFileSync(opLogPath(path), `${JSON.stringify(entry)}\n`);
  return id;
}

/**
 * Validate that the source a write would leave still parses and typechecks.
 * Returns the error list (empty array = success).
 */
function validate(src: string): { ok: true } | { ok: false; message: string } {
  try {
    const program = parse(lex(src));
    // Only `severity: "error"` diagnostics roll back a mutate op. Non-fatal
    // warnings (W02xx) describe pre-existing dead code patterns and would
    // wedge legitimate edits to unrelated layers.
    //
    // `requireApp: false` because a program is built one definition at a time:
    // the first `add` into a new file, and every edit until the `app` lands,
    // would otherwise roll back with E0003. Whether the result is a complete
    // application is what `kumiki check` answers afterwards.
    const errors = check(program, { requireApp: false }).filter((d) => d.severity !== "warning");
    if (errors.length > 0) {
      const summary = errors
        .slice(0, 3)
        .map((e) => `${e.code} ${e.message}`)
        .join("; ");
      return { ok: false, message: `Validation failed: ${summary}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `Parse/lex failed: ${String(e)}` };
  }
}

/**
 * Validate `next` and, only if it passes, put it on disk.
 *
 * The source is checked before it is written rather than written, re-read and
 * rolled back: a rollback restores a snapshot, and a snapshot restored over a
 * write the op never read is how one writer erased another's. The write
 * itself goes through a sibling file and a rename, so a reader that is not
 * holding the write lock — a `check`, a `list` — sees the old file or the new
 * one and never a half-written one.
 */
function commit(path: string, next: string, verb: string): void {
  const v = validate(next);
  if (!v.ok) throw new Error(`${verb} rejected: ${v.message}`);
  atomicWrite(path, next);
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.kumiki-write-${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

function writeLockPath(path: string): string {
  return `${path}.kumiki-write.lock`;
}

/**
 * How long a write waits for another writer to finish before it is rejected.
 * A write op holds the lock for one parse and typecheck, so this is many
 * times the longest one; a writer still waiting past it is reported rather
 * than left to hang.
 */
const WRITE_LOCK_WAIT_MS = 30_000;

/** The files this process holds the write lock on, with how deeply it is re-entered. */
const heldWriteLocks = new Map<string, number>();

/**
 * Run `fn` holding the write lock on `path`.
 *
 * Every write verb reads the file, composes a new one and appends to the op
 * log, and two of them interleaving lose one's edit while both report success
 * and both log an op (§9.8.2 allows an op to be rejected, not dropped). The
 * lock is a sibling file created with `wx`, so exactly one process holds it;
 * the others wait for it, and give up with an error — nothing written, nothing
 * logged — if it is not released in time. It is re-entrant within a process,
 * because `patch apply` and `patch revert` are made of the other verbs.
 *
 * A lock whose holder has exited without releasing it is taken over. That is
 * decided only for a holder on this host, where its pid can be asked about.
 */
function withWriteLock<T>(path: string, fn: () => T): T {
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
  acquireWriteLock(key);
  heldWriteLocks.set(key, 0);
  try {
    return fn();
  } finally {
    heldWriteLocks.delete(key);
    rmSync(writeLockPath(key), { force: true });
  }
}

type LockHolder = { pid: number; host: string };

function acquireWriteLock(path: string): void {
  const lock = writeLockPath(path);
  const deadline = Date.now() + WRITE_LOCK_WAIT_MS;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, host: hostname() }));
      } finally {
        closeSync(fd);
      }
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const holder = readLockHolder(lock);
    if (holder !== null && holderExited(holder)) {
      // Re-read before removing: another waiter may have taken the stale lock
      // over already, and the file now names a live writer.
      const again = readLockHolder(lock);
      if (again !== null && again.pid === holder.pid && again.host === holder.host) {
        rmSync(lock, { force: true });
      }
      continue;
    }
    if (Date.now() >= deadline) {
      const who = holder === null ? "another kumiki process" : `kumiki process ${holder.pid}`;
      throw new Error(`${path} is being written by ${who}; nothing was written. Try again.`);
    }
    Atomics.wait(nap, 0, 0, 5 + Math.floor(Math.random() * 20));
  }
}

/** The lock's holder, or `null` while it is still being written or is unreadable. */
function readLockHolder(lock: string): LockHolder | null {
  try {
    const parsed = JSON.parse(readFileSync(lock, "utf8")) as Partial<LockHolder>;
    return typeof parsed.pid === "number" && typeof parsed.host === "string"
      ? { pid: parsed.pid, host: parsed.host }
      : null;
  } catch {
    return null;
  }
}

function holderExited(holder: LockHolder): boolean {
  if (holder.host !== hostname()) return false;
  try {
    process.kill(holder.pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

type LockFile = { entries: Array<{ agent: string; patterns: string[] }> };

function readLocks(path: string): LockFile {
  const p = lockPath(path);
  if (!existsSync(p)) return { entries: [] };
  return JSON.parse(readFileSync(p, "utf8")) as LockFile;
}

function writeLocks(path: string, locks: LockFile): void {
  writeFileSync(lockPath(path), `${JSON.stringify(locks, null, 2)}\n`);
}

function patternToRegExp(pattern: string): RegExp {
  // Comma-separated globs: "slot.todos*,reducer.todo-*"
  const parts = pattern
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const reSrc = parts
    .map((g) => g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"))
    .join("|");
  return new RegExp(`^(${reSrc})$`);
}

function enforceLock(path: string, qname: string): void {
  const locks = readLocks(path);
  if (locks.entries.length === 0) return;
  const me = authorOf();
  for (const e of locks.entries) {
    if (e.agent === me) continue;
    for (const pat of e.patterns) {
      if (patternToRegExp(pat).test(qname)) {
        throw new Error(
          `lock violation: ${qname} is locked by ${e.agent} (pattern "${pat}"). Set KUMIKI_AUTHOR=${e.agent} to edit.`,
        );
      }
    }
  }
}

/**
 * What one mutation did, as the surfaces report it.
 *
 * Every op carries its op-id: it is the handle `kumiki patch revert` takes, so
 * an edit that does not hand it back cannot be undone by the caller that made
 * it. `remove` carries the definitions it deleted, because a cascade removes
 * the dependents of the name it was given — up to and including the `app` — and
 * a report naming only that one name is how a file loses its entry point
 * quietly.
 */
export type EditReport =
  | { op: "add" | "replace" | "edit"; qname: string; opId: string }
  | { op: "rename"; qname: string; newName: string; opId: string }
  | { op: "remove"; qname: string; opId: string; removed: RemovedNames };

/**
 * The definitions one `remove` deleted: the requested name, then the cascade.
 *
 * A remove always deletes at least the name it was given, and the report puts
 * that one on the headline line rather than among its own casualties — so the
 * split is the tuple, not a filter that has to recognise the name again.
 */
export type RemovedNames = [requested: string, ...cascaded: string[]];

/**
 * Render an `EditReport` for a human or an agent to read.
 *
 * The `kumiki` verbs print this and the MCP tools return it, so the two
 * surfaces cannot answer the same edit differently — they did, and the one
 * agents drive was the one saying less.
 */
export function describeEdit(report: EditReport): string {
  const opIdSuffix = `  (${report.opId})`;
  switch (report.op) {
    case "add":
      return `added ${report.qname}${opIdSuffix}`;
    case "replace":
      return `replaced ${report.qname}${opIdSuffix}`;
    case "edit":
      return `edited ${report.qname}${opIdSuffix}`;
    case "rename":
      return `renamed ${report.qname} -> ${report.newName}${opIdSuffix}`;
    case "remove": {
      const [, ...cascaded] = report.removed;
      return [
        `removed ${report.qname}${opIdSuffix}`,
        ...cascaded.map((q) => `  cascaded ${q}`),
      ].join("\n");
    }
  }
}

export function addDef(path: string, layer: string, name: string, body: string): string {
  return withWriteLock(path, () => addDefLocked(path, layer, name, body));
}

function addDefLocked(path: string, layer: string, name: string, body: string): string {
  enforceLock(path, `${layer}.${name}`);
  const src = readFileSync(path, "utf8");
  // Compose definition syntax for the requested layer. The body argument is
  // the right-hand side (e.g. "Int = 0" for a slot, "Bool -> Bool = not $1" for
  // a fn). Layer-specific assembly is small enough to inline here.
  const inserted = assemble(layer, name, body);
  const next = src.endsWith("\n") ? `${src}\n${inserted}\n` : `${src}\n\n${inserted}\n`;
  commit(path, next, "add");
  return logOp(path, { op: "add", layer, name, body });
}

export function replaceDef(path: string, qname: string, body: string): string {
  return withWriteLock(path, () => replaceDefLocked(path, qname, body));
}

function replaceDefLocked(path: string, qname: string, body: string): string {
  enforceLock(path, qname);
  const store = load(path);
  const entry = store.byQName.get(qname);
  if (!entry) throw new Error(`Definition "${qname}" not found`);
  const before = store.lines.slice(0, entry.range.startLine - 1);
  const after = store.lines.slice(entry.range.endLine);
  const inserted = assemble(entry.layer, entry.name, body).split(/\r?\n/);
  const next = [...before, ...inserted, ...after].join("\n");
  commit(path, next, "replace");
  return logOp(path, { op: "replace", layer: entry.layer, name: entry.name, body });
}

/** Removes `qname`, plus everything that references it when `cascade`. */
export function removeDef(
  path: string,
  qname: string,
  cascade: boolean,
): { opId: string; removed: RemovedNames } {
  return withWriteLock(path, () => removeDefLocked(path, qname, cascade));
}

function removeDefLocked(
  path: string,
  qname: string,
  cascade: boolean,
): { opId: string; removed: RemovedNames } {
  enforceLock(path, qname);
  const store = load(path);
  const entry = store.byQName.get(qname);
  if (!entry) throw new Error(`Definition "${qname}" not found`);
  const refs = findReferences(store, qname);
  if (refs.length > 0 && !cascade) {
    const summary = refs
      .slice(0, 5)
      .map((r) => `${r.qname}:${r.line}`)
      .join(", ");
    throw new Error(
      `Cannot remove ${qname}: ${refs.length} references (${summary}). Re-run with --cascade.`,
    );
  }
  // Cascade: collect distinct dependent qnames and remove them too. We do it
  // in dependency order — remove the leaves first.
  const toRemove = new Set<string>([qname]);
  if (cascade) {
    let frontier = [qname];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const q of frontier) {
        for (const r of findReferences(store, q)) {
          if (!toRemove.has(r.qname)) {
            toRemove.add(r.qname);
            next.push(r.qname);
          }
        }
      }
      frontier = next;
    }
  }
  // Remove from bottom up so line numbers stay valid.
  const removalEntries = [...toRemove]
    .map((q) => store.byQName.get(q))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .sort((a, b) => b.range.startLine - a.range.startLine);
  let lines = store.lines.slice();
  for (const e of removalEntries) {
    lines = [...lines.slice(0, e.range.startLine - 1), ...lines.slice(e.range.endLine)];
  }
  const next = lines.join("\n");
  commit(path, next, "remove");
  // §9.4.1: a cascade is one op, and it says what it took. Replay could already
  // reproduce the state — `applyOne` re-runs `removeDef` with `cascade`, which
  // re-derives the same dependent set — but nothing in the log or on stdout
  // said that removing one definition had removed eight. `removed` is written
  // whenever `cascade` was requested, including when it took nothing, so its
  // absence means "not a cascade" rather than "a cascade with no dependents".
  const removed: RemovedNames = [
    qname,
    ...removalEntries
      .map((e) => `${e.layer}.${e.name}`)
      .filter((q) => q !== qname)
      .sort((a, b) => a.localeCompare(b)),
  ];
  const opId = logOp(path, {
    op: "remove",
    layer: entry.layer,
    name: entry.name,
    cascade,
    ...(cascade ? { removed } : {}),
  });
  return { opId, removed };
}

export function renameDef(path: string, qname: string, newName: string): string {
  return withWriteLock(path, () => renameDefLocked(path, qname, newName));
}

function renameDefLocked(path: string, qname: string, newName: string): string {
  enforceLock(path, qname);
  const store = load(path);
  const entry = store.byQName.get(qname);
  if (!entry) throw new Error(`Definition "${qname}" not found`);
  const old = entry.name;
  if (old === newName) return logOp(path, { op: "rename", layer: entry.layer, name: old, newName });
  if (store.byQName.has(`${entry.layer}.${newName}`)) {
    throw new Error(`Cannot rename ${qname}: ${entry.layer}.${newName} already exists`);
  }

  // Every occurrence to rewrite, as (line, col) — the definition's own name plus
  // each resolved reference to it. Nothing else is touched, so a record field, a
  // word in a comment, a string literal and a loop variable that merely share
  // the spelling are left alone by construction rather than by a filter that has
  // to anticipate them.
  // Some references have no identifier position of their own — a test's
  // `{slots: {count: 0}}` key is a record key, not a token the AST points at.
  // They are edges for `refs` and `remove --cascade` but nothing `rename` can
  // rewrite, so refuse rather than half-rename the program.
  const unpositioned = store.defs.filter((e) =>
    referenceSites(store, `${e.layer}.${e.name}`).some(
      (r) => r.layer === entry.layer && r.name === old && !r.pos,
    ),
  );
  if (unpositioned.length > 0) {
    const where = unpositioned.map((e) => `${e.layer}.${e.name}`).join(", ");
    throw new Error(
      `Cannot rename ${qname}: it is named in a position with no rewritable identifier (${where}). Edit those definitions first.`,
    );
  }

  const sites: Pos[] = [defNamePos(store, entry, old)];
  for (const e of store.defs) {
    for (const r of referenceSites(store, `${e.layer}.${e.name}`)) {
      if (r.layer === entry.layer && r.name === old && r.pos) sites.push(r.pos);
    }
  }

  const lines = store.lines.slice();
  // Right-to-left within a line so earlier columns keep their positions.
  const byLine = new Map<number, number[]>();
  for (const p of sites) {
    const cols = byLine.get(p.line) ?? [];
    cols.push(p.col);
    byLine.set(p.line, cols);
  }
  for (const [line, cols] of byLine) {
    const text = lines[line - 1];
    if (text === undefined) {
      throw new Error(`rename aborted: reference at line ${line} is past the end of the file`);
    }
    let next = text;
    for (const col of [...new Set(cols)].sort((a, b) => b - a)) {
      const at = col - 1;
      if (next.slice(at, at + old.length) !== old) {
        throw new Error(
          `rename aborted: expected "${old}" at ${line}:${col} but found "${next.slice(at, at + old.length)}"`,
        );
      }
      next = next.slice(0, at) + newName + next.slice(at + old.length);
    }
    lines[line - 1] = next;
  }

  const next = lines.join("\n");
  commit(path, next, "rename");
  return logOp(path, { op: "rename", layer: entry.layer, name: old, newName });
}

/**
 * Where a definition's own name sits. The AST records the definition's start,
 * which is the keyword; the name is the first identifier after it.
 *
 * The search must begin past the keyword, not at it: `pos.col` is 1-based and
 * `indexOf`'s offset is 0-based, so starting at `col` began one character into
 * the keyword — and a name that is a suffix of its own keyword (`slot lot`,
 * `fn n`, `type e`) matched inside the keyword instead. That produced
 * `stotal lot` from `rename slot.lot total`, written to disk before `validate`
 * caught it and rolled back.
 */
function defNamePos(store: Store, entry: DefEntry, name: string): Pos {
  const line = store.lines[entry.range.startLine - 1] ?? "";
  const keywordCol = (entry.def as { pos?: Pos }).pos?.col ?? 1;
  const from = keywordCol - 1 + entry.layer.length;
  const at = line.indexOf(name, from);
  if (at < 0) throw new Error(`rename aborted: cannot locate "${name}" on its own definition line`);
  return { line: entry.range.startLine, col: at + 1 };
}

/**
 * Partial edit of a definition body. The patch is a JSON object in one of two
 * shapes (both from the spec §9.6.1 auto-patch precedent):
 *
 *   { "find": "...", "replace": "..." }            — replace one occurrence
 *   { "body:<line>": "replace 'a' -> 'b'" }       — per-line replacement
 *
 * The edit is confined to the target definition's source range; matches
 * outside the range are not touched.
 */
export function editDef(path: string, qname: string, patch: unknown): string {
  return withWriteLock(path, () => editDefLocked(path, qname, patch));
}

function editDefLocked(path: string, qname: string, patch: unknown): string {
  enforceLock(path, qname);
  const store = load(path);
  const entry = store.byQName.get(qname);
  if (!entry) throw new Error(`Definition "${qname}" not found`);
  const bodyStart = entry.range.startLine - 1;
  const bodyEnd = entry.range.endLine;
  const before = store.lines.slice(0, bodyStart);
  const target = store.lines.slice(bodyStart, bodyEnd);
  const after = store.lines.slice(bodyEnd);
  let updated: string[];
  if (isFindReplacePatch(patch)) {
    const joined = target.join("\n");
    if (!joined.includes(patch.find)) {
      throw new Error(`edit rejected: "find" pattern not present in ${qname}`);
    }
    // Function replacer so that `$&` / `$$` / `` $` `` / `$'` in the replacement
    // string aren't interpreted by String.prototype.replace.
    const replaceWith = patch.replace;
    updated = joined.replace(patch.find, () => replaceWith).split("\n");
  } else if (isPerLinePatch(patch)) {
    updated = target.slice();
    for (const [key, instruction] of Object.entries(patch)) {
      const m = /^body:(\d+)$/.exec(key);
      if (!m) throw new Error(`edit rejected: unknown patch key "${key}"`);
      const lineIdx = Number.parseInt(m[1]!, 10) - 1;
      const repl = /^replace\s+'([^']*)'\s*->\s*'([^']*)'$/.exec(String(instruction));
      if (!repl) throw new Error(`edit rejected: cannot parse instruction "${instruction}"`);
      const [, from, to] = repl;
      const cur = updated[lineIdx];
      if (cur === undefined)
        throw new Error(`edit rejected: body line ${lineIdx + 1} out of range`);
      const toStr = to!;
      updated[lineIdx] = cur.replace(from!, () => toStr);
    }
  } else {
    throw new Error(
      `edit rejected: patch must be {find,replace} or {body:<n>: "replace 'a' -> 'b'"}`,
    );
  }
  const next = [...before, ...updated, ...after].join("\n");
  commit(path, next, "edit");
  // Record the post-edit body so `depends-on` is computable and
  // `patchRevert(editId)` can find a usable prior body via the op log. The
  // recorded body is the *logical* body (the RHS of `assemble`), so feeding
  // it back into addDef/replaceDef round-trips cleanly.
  const updatedStore = load(path);
  const updatedEntry = updatedStore.byQName.get(qname);
  const fullDef = updatedEntry
    ? updatedStore.lines
        .slice(updatedEntry.range.startLine - 1, updatedEntry.range.endLine)
        .join("\n")
    : undefined;
  const newBody = fullDef !== undefined ? extractBody(entry.layer, entry.name, fullDef) : undefined;
  return logOp(path, {
    op: "edit",
    layer: entry.layer,
    name: entry.name,
    patch,
    ...(newBody !== undefined ? { body: newBody } : {}),
  });
}

/**
 * Inverse of `assemble`: strip the layer-specific opener (`slot <name> :`,
 * `type <name> =`, …) so we recover the "logical body" written by the user
 * and stored in op log entries.
 */
function extractBody(layer: string, name: string, source: string): string {
  const n = escapeRegExp(name);
  const text = source;
  switch (layer) {
    case "type":
    case "tile":
    case "theme":
      return text.replace(new RegExp(`^\\s*${layer}\\s+${n}\\s*=\\s*`), "").trimEnd();
    case "slot":
      return text.replace(new RegExp(`^\\s*slot\\s+${n}\\s*:\\s*`), "").trimEnd();
    case "effect":
    case "reducer":
      return text.replace(new RegExp(`^\\s*${layer}\\s+${n}\\s+`), "").trimEnd();
    case "fn":
      return text.replace(new RegExp(`^\\s*fn\\s+${n}\\s*`), "").trimEnd();
    case "app":
      return text.replace(new RegExp(`^\\s*app\\s+${n}\\n?`), "").trimEnd();
    default:
      return text;
  }
}

function isFindReplacePatch(p: unknown): p is { find: string; replace: string } {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof (p as { find?: unknown }).find === "string" &&
    typeof (p as { replace?: unknown }).replace === "string"
  );
}

function isPerLinePatch(p: unknown): p is Record<string, string> {
  if (typeof p !== "object" || p === null) return false;
  const keys = Object.keys(p);
  // An empty object would vacuously satisfy the per-line predicate; reject it
  // so callers can't record a no-op edit.
  if (keys.length === 0) return false;
  for (const k of keys) if (!k.startsWith("body:")) return false;
  return true;
}

/**
 * Apply a CRDT op bundle (JSONL, one op per line). Each line is dispatched to
 * the matching mutation. On any failure the file is restored to its state
 * before the call.
 */
export function patchApplyFile(path: string, opsFile: string): string[] {
  return withWriteLock(path, () => patchApplyFileLocked(path, opsFile));
}

function patchApplyFileLocked(path: string, opsFile: string): string[] {
  const original = readFileSync(path, "utf8");
  const originalLog = existsSync(opLogPath(path)) ? readFileSync(opLogPath(path), "utf8") : null;
  const lines = readFileSync(opsFile, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const ids: string[] = [];
  try {
    for (const line of lines) {
      const op = JSON.parse(line) as RawOp;
      ids.push(applyOne(path, op));
    }
    return ids;
  } catch (e) {
    atomicWrite(path, original);
    if (originalLog === null) {
      // Bundle started without an op log — delete the file the partial apply
      // created instead of leaving an empty one behind.
      if (existsSync(opLogPath(path))) unlinkSync(opLogPath(path));
    } else {
      writeFileSync(opLogPath(path), originalLog);
    }
    throw new Error(`patch apply rejected: ${String(e)}`);
  }
}

function applyOne(path: string, op: RawOp): string {
  switch (op.op) {
    case "add":
      if (op.body === undefined) throw new Error("add op missing body");
      return addDef(path, op.layer, op.name, op.body);
    case "replace":
      if (op.body === undefined) throw new Error("replace op missing body");
      return replaceDef(path, `${op.layer}.${op.name}`, op.body);
    case "edit":
      if (op.patch === undefined) throw new Error("edit op missing patch");
      return editDef(path, `${op.layer}.${op.name}`, op.patch);
    case "rename":
      if (!op.newName) throw new Error("rename op missing newName");
      return renameDef(path, `${op.layer}.${op.name}`, op.newName);
    case "remove":
      return removeDef(path, `${op.layer}.${op.name}`, op.cascade ?? false).opId;
    default:
      throw new Error(`unknown op kind "${op.op}"`);
  }
}

/**
 * Revert a single op. We compute the inverse by reading the op-log, locating
 * the target op, and replaying the original source up to just before it. This
 * is the simplest correct strategy for the PoC; op volume is small.
 */
export function patchRevert(path: string, opId: string): string {
  return withWriteLock(path, () => patchRevertLocked(path, opId));
}

function patchRevertLocked(path: string, opId: string): string {
  const log = readOpLog(path);
  const idx = log.findIndex((e) => e["op-id"] === opId);
  if (idx === -1) throw new Error(`patch revert: op-id "${opId}" not found in log`);
  const target = log[idx]!;
  switch (target.op) {
    case "add":
      // Inverse of add = remove.
      return removeDef(path, `${target.layer}.${target.name}`, false).opId;
    case "remove": {
      // Inverse of remove = add. The removed body was the previous replace/add body.
      const prev = priorBody(log, idx, target.layer, target.name);
      if (prev === undefined) {
        throw new Error(
          `patch revert: cannot reconstruct body of removed ${target.layer}.${target.name}`,
        );
      }
      return addDef(path, target.layer, target.name, prev);
    }
    case "replace": {
      const prev = priorBody(log, idx, target.layer, target.name);
      if (prev === undefined) {
        throw new Error(`patch revert: no prior body found for ${target.layer}.${target.name}`);
      }
      return replaceDef(path, `${target.layer}.${target.name}`, prev);
    }
    case "edit": {
      // Best-effort: rebuild prior body from history.
      const prev = priorBody(log, idx, target.layer, target.name);
      if (prev === undefined) {
        throw new Error(
          `patch revert: cannot reconstruct prior body for edit of ${target.layer}.${target.name}`,
        );
      }
      return replaceDef(path, `${target.layer}.${target.name}`, prev);
    }
    case "rename": {
      if (!target.newName) throw new Error("patch revert: rename op missing newName");
      return renameDef(path, `${target.layer}.${target.newName}`, target.name);
    }
    default:
      throw new Error(`patch revert: unsupported op kind "${target.op}"`);
  }
}

function priorBody(
  log: OpLogEntry[],
  idx: number,
  layer: string,
  name: string,
): string | undefined {
  for (let i = idx - 1; i >= 0; i--) {
    const e = log[i]!;
    if (e.layer === layer && e.name === name && typeof e.body === "string") return e.body;
  }
  return undefined;
}

/** Return op log entries for a specific qname in chronological order. */
export function viewHistory(path: string, qname: string): OpLogEntry[] {
  const [layer, name] = splitQname(qname);
  return readOpLog(path).filter((e) => e.layer === layer && e.name === name);
}

/**
 * Content hash of a definition: sha256 of its body XOR-mixed with the hashes
 * of its transitive deps. PoC stand-in for the blake3-based hash specified in
 * §9.5.1. Shared with `computeDependsOn` so `view --hash <q>` and the `@h:`
 * digest in another op's `depends-on` line up.
 */
export function viewHash(store: Store, qname: string): string {
  return computeHash(store, qname, new Map());
}

function computeHash(store: Store, qname: string, memo: Map<string, string>): string {
  const cached = memo.get(qname);
  if (cached !== undefined) return cached;
  // Insert a sentinel up-front so diamond deps reach the same hash regardless
  // of traversal order and a true cycle (kumiki spec disallows them, but be
  // robust) terminates instead of stack-overflowing.
  memo.set(qname, "__cyc__");
  const entry = store.byQName.get(qname);
  if (!entry) {
    const h = hashBody(qname);
    memo.set(qname, h);
    return h;
  }
  const body = store.lines.slice(entry.range.startLine - 1, entry.range.endLine).join("\n");
  const deps = directDeps(store, qname).sort();
  const depPart = deps.map((d) => computeHash(store, d, memo)).join(":");
  const h = hashBody(`${body}|${depPart}`);
  memo.set(qname, h);
  return h;
}

export function lockDef(path: string, agentId: string, pattern: string): void {
  withWriteLock(path, () => lockDefLocked(path, agentId, pattern));
}

function lockDefLocked(path: string, agentId: string, pattern: string): void {
  const locks = readLocks(path);
  const patterns = pattern
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const existing = locks.entries.find((e) => e.agent === agentId);
  if (existing) {
    for (const p of patterns) if (!existing.patterns.includes(p)) existing.patterns.push(p);
  } else {
    locks.entries.push({ agent: agentId, patterns });
  }
  writeLocks(path, locks);
}

export function unlockDef(path: string, agentId: string): void {
  withWriteLock(path, () => unlockDefLocked(path, agentId));
}

function unlockDefLocked(path: string, agentId: string): void {
  const locks = readLocks(path);
  locks.entries = locks.entries.filter((e) => e.agent !== agentId);
  writeLocks(path, locks);
}

export function episodeLogPathFor(path: string): string {
  return episodeLogPath(path);
}

function splitQname(qname: string): [string, string] {
  const dot = qname.indexOf(".");
  if (dot < 0) throw new Error(`qname must be "<layer>.<name>": ${qname}`);
  return [qname.slice(0, dot), qname.slice(dot + 1)];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assemble(layer: string, name: string, body: string): string {
  // Each layer has its canonical opener. Keep this regenerable from the AST
  // later; for the PoC we lean on tiny templates.
  switch (layer) {
    case "type":
      return `type ${name} = ${body}`;
    case "slot":
      return `slot ${name} : ${body}`;
    case "effect":
      return `effect ${name} ${body}`;
    case "reducer":
      return `reducer ${name} ${body}`;
    case "tile":
      return `tile ${name} = ${body}`;
    case "fn":
      return `fn ${name}${body.startsWith("(") ? "" : " "}${body}`;
    case "app":
      return `app ${name}\n${body}`;
    case "theme":
      return `theme ${name} = ${body}`;
    default:
      throw new Error(`Unknown layer "${layer}"`);
  }
}
