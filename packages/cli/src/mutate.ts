// Mutating commands for the kumiki CLI. Each mutation rewrites the .kumiki
// file and appends an entry to `<file>.kumiki-ops.jsonl`.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, rmSync, statSync, truncateSync } from "node:fs";
import { check, type Def, LexError, lex, type Pos, parse, type Token } from "@kumikijs/compiler";
import {
  type DefEntry,
  directDeps,
  findReferences,
  load,
  loadSource,
  referenceSites,
  requireSourceFile,
  type Store,
  viewDef,
} from "./store.ts";
import { atomicWriteFileSync, withWriteLock } from "./write-lock.ts";

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
  /**
   * `remove` only: the source of every definition the op deleted, as it stood
   * when it was deleted, the requested one first. It is what `patch revert`
   * restores, so the restore never depends on reconstructing a body from
   * earlier ops.
   */
  bodies?: DefSpec[];
  /**
   * The definitions an `add` restores together with the named one — the
   * inverse of a cascade, which is one op in both directions.
   */
  with?: DefSpec[];
  /**
   * `replace` and `edit` only: the body the definition had before the op, as
   * it stood in the file. It is what `patch revert` writes back, so the revert
   * never depends on a body some earlier op happened to log.
   */
  prev?: string;
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
  bodies?: DefSpec[];
  with?: DefSpec[];
  prev?: string;
  patch?: unknown;
};

/** One definition as an `add` writes it: its layer, its name and its body. */
export type DefSpec = { layer: string; name: string; body: string };

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
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as OpLogEntry;
    const problem = opShapeProblem(entry);
    if (problem !== undefined) throw new Error(`${p}:${i + 1}: ${problem}`);
    out.push(entry);
  }
  return out;
}

/**
 * What is wrong with the definition lists an op carries, if anything. An op
 * read from a patch file or the op log is only JSON; without this a `with`
 * member missing its `name` was written to the file as `slot undefined`, and a
 * `with` that is not an array threw a TypeError from deep inside a revert.
 */
function opShapeProblem(op: RawOp): string | undefined {
  const own = `${op.layer}.${op.name}`;
  if (op.with !== undefined) {
    if (op.op !== "add") return "`with` is only valid on `add`";
    const problem = defSpecsProblem(op.with, "with");
    if (problem !== undefined) return problem;
  }
  if (op.bodies !== undefined) {
    if (op.op !== "remove") return "`bodies` is only valid on `remove`";
    const problem = defSpecsProblem(op.bodies, "bodies");
    if (problem !== undefined) return problem;
    const [first] = op.bodies;
    if (first === undefined || `${first.layer}.${first.name}` !== own) {
      return `\`bodies\` must start with the op's own definition ${own}`;
    }
  }
  if (op.prev !== undefined) {
    if (op.op !== "replace" && op.op !== "edit")
      return "`prev` is only valid on `replace` and `edit`";
    const prev: unknown = op.prev;
    if (typeof prev !== "string") return "`prev` must be a string";
  }
  if (op.removed !== undefined) {
    if (op.op !== "remove" || op.cascade !== true) {
      return "`removed` is only valid on a cascade `remove`";
    }
    const removed: unknown = op.removed;
    if (!Array.isArray(removed) || !removed.every((q) => typeof q === "string")) {
      return "`removed` must be an array of qualified names";
    }
    if (removed[0] !== own) return `\`removed\` must start with the op's own definition ${own}`;
  }
  return undefined;
}

function defSpecsProblem(value: unknown, field: string): string | undefined {
  if (!Array.isArray(value)) return `\`${field}\` must be an array`;
  for (const [i, d] of value.entries()) {
    if (typeof d !== "object" || d === null) return `\`${field}\`[${i}] must be an object`;
    for (const key of ["layer", "name", "body"] as const) {
      if (typeof (d as Record<string, unknown>)[key] !== "string") {
        return `\`${field}\`[${i}].${key} must be a string`;
      }
    }
  }
  return undefined;
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
    ...(op.bodies !== undefined ? { bodies: op.bodies } : {}),
    ...(op.with !== undefined ? { with: op.with } : {}),
    ...(op.prev !== undefined ? { prev: op.prev } : {}),
    ...(op.patch !== undefined ? { patch: op.patch } : {}),
    author: authorOf(),
    ts: Date.now(),
    "op-id": id,
    "parent-ops": parents ? [parents] : [],
    "depends-on": dependsOn,
  };
  appendLine(opLogPath(path), JSON.stringify(entry));
  return id;
}

/**
 * Append one line, or leave the file as it was: an append that fails partway
 * (ENOSPC) would otherwise leave a torn last line that no later read can parse.
 */
function appendLine(file: string, line: string): void {
  const size = existsSync(file) ? statSync(file).size : null;
  try {
    appendFileSync(file, `${line}\n`);
  } catch (e) {
    try {
      if (size === null) rmSync(file, { force: true });
      else truncateSync(file, size);
    } catch {
      // The append's error is the one to report.
    }
    throw e;
  }
}

/**
 * Decide whether `next` may replace `before` on `path`. Returns the reason to
 * refuse, if there is one.
 *
 * The new source must parse and typecheck, and no definition the write
 * touches may be locked by another agent (§9.8.3). What is touched is read
 * off the two sources, not off the verb: a body is written as given, so a
 * `replace` / `add` / `edit` body can carry a second definition with it, a
 * cascade removes dependents and a rename rewrites referrers.
 */
function validate(
  path: string,
  before: string,
  src: string,
): { ok: true } | { ok: false; message: string } {
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
  } catch (e) {
    return { ok: false, message: `Parse/lex failed: ${String(e)}` };
  }
  const locked = lockViolation(path, touchedDefinitions(before, src));
  return locked === undefined ? { ok: true } : { ok: false, message: locked };
}

/** The one order qualified names are listed in, in reports and in checks. */
const compareQNames = (a: string, b: string): number => a.localeCompare(b);

/**
 * Every definition that differs between two sources: added, removed, or with
 * different text. A source that does not parse contributes no definitions, so
 * everything in the other one counts as touched.
 */
function touchedDefinitions(before: string, after: string): string[] {
  const a = definitionTexts(before);
  const b = definitionTexts(after);
  const touched = new Set<string>();
  for (const [q, text] of a) if (b.get(q) !== text) touched.add(q);
  for (const q of b.keys()) if (!a.has(q)) touched.add(q);
  return [...touched].sort(compareQNames);
}

function definitionTexts(source: string): Map<string, string> {
  const out = new Map<string, string>();
  let store: Store;
  try {
    store = loadSource(source);
  } catch {
    return out;
  }
  for (const e of store.defs) {
    const q = `${e.layer}.${e.name}`;
    const text = store.lines.slice(e.range.startLine - 1, e.range.endLine).join("\n");
    // A name defined twice keeps both texts, so touching either one shows.
    const prior = out.get(q);
    out.set(q, prior === undefined ? text : `${prior}\n\0\n${text}`);
  }
  return out;
}

/**
 * Validate `next`, put it on disk only if it passes, then log the op.
 *
 * The source is checked before it is written rather than written, re-read and
 * rolled back: a rollback restores a snapshot, and a snapshot restored over a
 * write the op never read is how one writer erased another's. The write goes
 * through a sibling file and a rename, so a reader that is not holding the
 * write lock — a `check`, a `list` — sees the old file or the new one and
 * never a half-written one.
 *
 * `log` runs after the write, because the op's `depends-on` is computed from
 * the file as the op left it. If it throws, the file is put back as it was, so
 * an op is never in the file without being in the log. That is safe only
 * because the caller holds the write lock: no other write can have landed in
 * between.
 */
function commit(path: string, next: string, verb: string, log: () => string): string {
  const before = readFileSync(path, "utf8");
  const v = validate(path, before, next);
  if (!v.ok) throw new Error(`${verb} rejected: ${v.message}`);
  atomicWriteFileSync(path, next);
  try {
    return log();
  } catch (e) {
    try {
      atomicWriteFileSync(path, before);
    } catch (r) {
      throw new Error(
        `${verb} failed: the op could not be logged (${messageOf(e)}), and restoring ${path} failed too (${messageOf(r)}); the file holds an edit the op log does not`,
        { cause: e },
      );
    }
    throw new Error(
      `${verb} rejected: the op could not be logged (${messageOf(e)}); the file was restored and nothing was written`,
      { cause: e },
    );
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type LockFile = { entries: Array<{ agent: string; patterns: string[] }> };

function readLocks(path: string): LockFile {
  const p = lockPath(path);
  if (!existsSync(p)) return { entries: [] };
  return JSON.parse(readFileSync(p, "utf8")) as LockFile;
}

function writeLocks(path: string, locks: LockFile): void {
  // By rename: `enforceLock` reads this file without the write lock.
  atomicWriteFileSync(lockPath(path), `${JSON.stringify(locks, null, 2)}\n`);
}

/** The globs of a lock pattern, which are comma-separated: "slot.todos*,reducer.todo-*". */
function patternGlobs(pattern: string): string[] {
  return pattern
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * In a glob, `*` stands for any run of characters, dots included, and every
 * other character for itself. `globsOverlap` reads a glob the same way.
 */
function patternToRegExp(pattern: string): RegExp {
  const reSrc = patternGlobs(pattern)
    .map((g) => g.split("*").map(escapeRegExp).join(".*"))
    .join("|");
  return new RegExp(`^(${reSrc})$`);
}

/**
 * Whether some name with exactly one dot, the shape of every qualified name,
 * matches both globs, each read as `patternToRegExp` reads it. Neither layers
 * nor the characters a name may have are known here, so `slot.count?` overlaps
 * `slot.*` though no qualified name matches `slot.count?`. Neither glob has to
 * contain the other: `slot.a*` and `slot.*b` share `slot.ab`. `slot.a*` and
 * `*.inc` share no such name: what matches both is `slot.a.inc` and the like.
 *
 * The globs are walked together from the left, spelling a name that matches
 * both. A state of the walk is how far it is into each glob and how many dots
 * it has spelled. A step spells the character both globs have next, or one
 * glob's next character while a `*` of the other takes it, or ends a `*`.
 * Where both have a `*` next, the two can spell the dot between them (`slot*`
 * and `*count` share `slot.count`); any other character spelled there can be
 * left out. The states still to visit are kept in a list rather than on the
 * call stack, so globs of any length are compared.
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

/**
 * The refusal for the first of `qnames` another agent holds a lock on, if any.
 * The one matcher both lock checks use: `enforceLock` on the named definition,
 * and `validate` on everything the write touches.
 */
function lockViolation(path: string, qnames: readonly string[]): string | undefined {
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

/**
 * Refuse, before anything is written, an op whose named definition is locked.
 * Everything else the op turns out to touch is checked by `validate`, once the
 * composed source shows what that is.
 *
 * Each write verb runs this before it waits for the write lock, so an op that
 * may not touch its definition at all is told so at once rather than after
 * the wait, and again under the write lock, where an ownership lock taken
 * during the wait is seen.
 */
function enforceLock(path: string, qname: string): void {
  const locked = lockViolation(path, [qname]);
  if (locked !== undefined) throw new Error(locked);
}

/**
 * What one mutation did, as the surfaces report it.
 *
 * Every op carries its op-id: it is the handle `kumiki patch revert` takes, so
 * an edit that does not hand it back cannot be undone by the caller that made
 * it. `remove` carries the definitions it deleted, because a cascade removes
 * the dependents of the name it was given — up to and including the `app` — and
 * a report naming only that one name is how a file loses its entry point
 * quietly. `replace` carries the clauses and parameters its body no longer
 * states (`headerItems`), for the same reason: the write is valid, so nothing
 * else would say they are gone.
 */
export type EditReport =
  | { op: "add" | "edit"; qname: string; opId: string }
  | { op: "replace"; qname: string; opId: string; dropped?: readonly string[] }
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
      return [
        `replaced ${report.qname}${opIdSuffix}`,
        ...(report.dropped ?? []).map((item) => `  dropped ${item}`),
      ].join("\n");
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
  requireSourceFile(path);
  enforceLock(path, `${layer}.${name}`);
  return withWriteLock(path, () => addDefs(path, [{ layer, name, body }]));
}

/**
 * Add one or more definitions as a single op: one write, one validation, one
 * log entry. The first is the op's own `layer` / `name` / `body`; the rest are
 * its `with`. They are written in one batch and validated once, as a whole,
 * because they may reference each other: a cascade's dependents do not
 * typecheck on their own, without the definition they depend on.
 */
function addDefs(path: string, defs: readonly [DefSpec, ...DefSpec[]]): string {
  for (const d of defs) {
    if (!isDefinitionName(d.name)) {
      throw new Error(
        `add rejected: "${d.name}" is not one identifier, so it cannot name a definition (a tile's clauses and a type's parameters go at the start of the body); nothing was written`,
      );
    }
  }
  // The named definition up front; the rest of `with` is covered by the
  // before/after diff in `validate`, like anything else the write adds.
  enforceLock(path, `${defs[0].layer}.${defs[0].name}`);
  const src = readFileSync(path, "utf8");
  // The body argument is the definition after its name and the layer's
  // separator (e.g. "Int = 0" for a slot, "Bool -> Bool = not $1" for a fn).
  // A tile or a type states its header; one added without states that it has
  // none, which is how it is written and logged.
  const stated = (d: DefSpec): DefSpec => ({ ...d, body: withHeader(d.layer, d.body, () => "= ") });
  const [first, ...others] = defs;
  const main = stated(first);
  const rest = others.map(stated);
  const inserted = [main, ...rest].map((d) => assemble(d.layer, d.name, d.body)).join("\n\n");
  const next = src.endsWith("\n") ? `${src}\n${inserted}\n` : `${src}\n\n${inserted}\n`;
  return commit(path, next, "add", () =>
    logOp(path, { op: "add", ...main, ...(rest.length > 0 ? { with: rest } : {}) }),
  );
}

/**
 * Whether `name` lexes as one identifier, as every definition's name does. A
 * name is written into the file as given, so anything more becomes part of the
 * definition — `add type 'Box(T)' …` would write `type Box(T) = …` — while the
 * op is logged under a name no definition has, which nothing can view, revert
 * or remove.
 */
function isDefinitionName(name: string): boolean {
  let tokens: Token[];
  try {
    tokens = lex(name);
  } catch (e) {
    if (e instanceof LexError) return false;
    throw e;
  }
  const [only, end] = tokens;
  return only?.kind === "ident" && only.value === name && end?.kind === "eof";
}

/**
 * Replace a definition with `body`. A body that does not state a tile's
 * clauses or a type's parameters (`statesHeader`) keeps the ones the
 * definition has: a body that rewrites only what follows the `=` must not
 * drop them unnoticed. One that states them may state fewer, and `dropped`
 * names each clause or parameter the definition no longer has.
 *
 * The op records the body the definition had (`prev`), which is what
 * `patch revert` writes back, and logs the body it wrote with its header
 * stated, so a logged body means the same to every reader.
 */
export function replaceDef(
  path: string,
  qname: string,
  body: string,
): { opId: string; dropped: string[] } {
  requireSourceFile(path);
  enforceLock(path, qname);
  return withWriteLock(path, () => replaceDefLocked(path, qname, body));
}

function replaceDefLocked(
  path: string,
  qname: string,
  body: string,
): { opId: string; dropped: string[] } {
  enforceLock(path, qname);
  const store = load(path);
  const entry = store.byQName.get(qname);
  if (!entry) throw new Error(`Definition "${qname}" not found`);
  const prev = bodyOf(store, entry, "replace");
  const whole = withHeader(entry.layer, body, () => headerOf(store, entry, "replace"));
  const before = store.lines.slice(0, entry.range.startLine - 1);
  const after = store.lines.slice(entry.range.endLine);
  const inserted = assemble(entry.layer, entry.name, whole).split(/\r?\n/);
  const next = [...before, ...inserted, ...after].join("\n");
  const opId = commit(path, next, "replace", () =>
    logOp(path, { op: "replace", layer: entry.layer, name: entry.name, body: whole, prev }),
  );
  const now = headerItems(load(path).byQName.get(qname)?.def);
  return { opId, dropped: headerItems(entry.def).filter((item) => !now.includes(item)) };
}

/**
 * How a body states the header of a tile or a type — what the definition has
 * between its name and the `=` before its right-hand side — keyed by the
 * layers that have one: it starts with a clause (`<word> =`) or with the
 * parameters' `(`, or with that `=`, which states there is nothing there.
 * Neither right-hand side can start that way: a tile's opens with a tile name
 * or `for` / `when` / `if` / `match`, never `<word> =`, and a type's never
 * opens with `(` or `=`. So a body is read one way or the other by its first
 * characters alone.
 */
const HEADER_START: ReadonlyMap<string, RegExp> = new Map([
  ["tile", /^\s*(?:=|[A-Za-z_][A-Za-z0-9_-]*\s*=)/],
  ["type", /^\s*[(=]/],
]);

function statesHeader(layer: string, body: string): boolean {
  return HEADER_START.get(layer)?.test(body) ?? false;
}

/**
 * `body` with its header stated: as given when it states one, or when its
 * layer has none; otherwise after `header()` — the definition's own header
 * for a `replace`, `= ` (none) for an `add`.
 */
function withHeader(layer: string, body: string, header: () => string): string {
  return !HEADER_START.has(layer) || statesHeader(layer, body) ? body : `${header()}${body}`;
}

/**
 * Where the header of a tile or a type sits in its definition's text: from
 * the first token after the name — a clause, the parameters' `(`, or the `=`
 * when there is no header — to the right-hand side, which starts where the
 * parser put the definition's body. Read off the tokens, so a comment after
 * the name is never taken for part of the header. Throws, naming the
 * definition, when the text is not laid out that way.
 */
function headerSpan(
  store: Store,
  entry: DefEntry,
  verb: string,
): { text: string; from: number; to: number } {
  const qname = `${entry.layer}.${entry.name}`;
  const text = viewDef(store, qname) ?? "";
  const rhs = rightHandSide(entry.def);
  const lines = text.split("\n");
  // Positions relative to the definition's text: its first line is line 1.
  const offset = (line: number, col: number): number =>
    lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
  const tokens = lex(text);
  const [keyword, name, first] = tokens;
  const line = rhs === undefined ? 0 : rhs.line - entry.range.startLine + 1;
  const at = tokens.findIndex((t) => t.pos.line === line && t.pos.col === rhs?.col);
  const eq = tokens[at - 1];
  if (
    rhs === undefined ||
    keyword?.kind !== "kw" ||
    keyword.value !== entry.layer ||
    name?.kind !== "ident" ||
    name.value !== entry.name ||
    first === undefined ||
    at < 3 ||
    eq?.kind !== "op" ||
    eq.value !== "="
  ) {
    throw new Error(`${verb} rejected: cannot locate the header of ${qname}`);
  }
  return { text, from: offset(first.pos.line, first.pos.col), to: offset(line, rhs.col) };
}

/** Where the parser put the right-hand side of a definition that has a header. */
function rightHandSide(def: Def): Pos | undefined {
  switch (def.kind) {
    case "TileDef":
    case "TypeDef":
      return def.body.pos;
    default:
      return undefined;
  }
}

/** A tile's or a type's header and the `=` after it: `error-boundary=Oops = `, `(T) = `, `= `. */
function headerOf(store: Store, entry: DefEntry, verb: string): string {
  const { text, from, to } = headerSpan(store, entry, verb);
  return text.slice(from, to);
}

/**
 * The body of a definition in the file: the definition without `<layer>
 * <name>`, as the op log records it and `assemble` writes it back. A tile's
 * or a type's starts with its header, or with its `=` when it has none.
 */
function bodyOf(store: Store, entry: DefEntry, verb: string): string {
  if (HEADER_START.has(entry.layer)) {
    const { text, from } = headerSpan(store, entry, verb);
    return text.slice(from).trimEnd();
  }
  return extractBody(entry.layer, entry.name, viewDef(store, `${entry.layer}.${entry.name}`) ?? "");
}

/**
 * What the header of a tile or a type says, item by item: the clauses that
 * change what the tile does, and the parameters. `scroll-restoration=true` is
 * the default, so the parser keeps nothing of it and it is not an item.
 */
function headerItems(def: Def | undefined): string[] {
  switch (def?.kind) {
    case "TileDef":
      return [
        ...(def.in !== undefined ? ["in"] : []),
        ...(def.errorBoundary !== undefined ? ["error-boundary"] : []),
        ...(def.scrollRestoration === false ? ["scroll-restoration"] : []),
        ...(def.subRoutes !== undefined ? ["sub-routes"] : []),
      ];
    case "TypeDef":
      return def.params.map((p) => `parameter ${p}`);
    default:
      return [];
  }
}

/**
 * What `cascade` adds to a remove (§9.4.1), in the words both surfaces use: the
 * `--cascade` help of `kumiki remove` and the `kumiki_remove` description. One
 * string, so the two state the relation `removeDef` walks, from the target out
 * to whatever references it, and cannot state different ones.
 */
export const CASCADE_HELP =
  "also remove its dependents: every definition that references it, directly or transitively, which can include the app";

/** Removes `qname`, plus everything that references it when `cascade`. */
export function removeDef(
  path: string,
  qname: string,
  cascade: boolean,
): { opId: string; removed: RemovedNames } {
  requireSourceFile(path);
  enforceLock(path, qname);
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
  // Cascade: collect every transitive dependent and remove it too.
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
  toRemove.delete(qname);
  const set: RemovedNames = [qname, ...[...toRemove].sort(compareQNames)];
  return removeSet(path, store, set, cascade);
}

/**
 * Remove exactly `set` as one op, its first member being the op's own
 * definition. `removeDef` hands it the set a cascade derived; the inverse of a
 * restoring `add` and the replay of a logged cascade hand it the set the op
 * recorded, which is not re-derived: what references the first member now may
 * be more or less than what did when the op was made.
 *
 * Refused before anything is written when the first member is locked by
 * another agent, or a member is no longer in the file or is referenced by a
 * definition outside the set — removing it would leave that reference
 * dangling. Any other locked member is caught by `validate`'s before/after
 * diff, which rolls the write back.
 */
function removeSet(
  path: string,
  store: Store,
  set: RemovedNames,
  cascade: boolean,
): { opId: string; removed: RemovedNames } {
  enforceLock(path, set[0]);
  const missing = set.filter((q) => !store.byQName.has(q));
  if (missing.length > 0) {
    throw new Error(
      `remove rejected: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} no longer in the file; nothing was written`,
    );
  }
  const members = new Set<string>(set);
  const dangling = new Set<string>();
  for (const q of set) {
    for (const r of findReferences(store, q)) {
      if (!members.has(r.qname)) dangling.add(`${r.qname} references ${q}`);
    }
  }
  if (dangling.size > 0) {
    throw new Error(
      `remove rejected: ${[...dangling].sort().join("; ")}, outside the definitions being removed (${set.join(", ")}); nothing was written`,
    );
  }
  const entries = set.map((q) => store.byQName.get(q)).filter((e) => e !== undefined);
  // Each body as it stands now, so a revert restores this — not the last body
  // some earlier op happened to log, which a rename of something it references
  // leaves stale.
  const [main, ...rest] = entries.map((e) => ({
    layer: e.layer,
    name: e.name,
    body: bodyOf(store, e, "remove"),
  }));
  if (main === undefined) throw new Error("remove rejected: nothing to remove");
  // Remove from bottom up so line numbers stay valid.
  let lines = store.lines.slice();
  for (const e of [...entries].sort((a, b) => b.range.startLine - a.range.startLine)) {
    lines = [...lines.slice(0, e.range.startLine - 1), ...lines.slice(e.range.endLine)];
  }
  // §9.4.1: a cascade is one op, and it says what it took. `removed` is written
  // whenever `cascade` was requested, including when it took nothing, so its
  // absence means "not a cascade" rather than "a cascade with no dependents".
  // A replay removes that recorded set (`applyOne`).
  const opId = commit(path, lines.join("\n"), "remove", () =>
    logOp(path, {
      op: "remove",
      layer: main.layer,
      name: main.name,
      cascade,
      ...(cascade ? { removed: set } : {}),
      bodies: [main, ...rest],
    }),
  );
  return { opId, removed: set };
}

export function renameDef(path: string, qname: string, newName: string): string {
  requireSourceFile(path);
  enforceLock(path, qname);
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

  const { own, refs, unpositioned } = nameSites(store, entry);
  // A reference with no identifier position of its own is an edge for `refs`
  // and `remove --cascade` but nothing `rename` can rewrite, so refuse rather
  // than half-rename the program.
  if (unpositioned.length > 0) {
    throw new Error(
      `Cannot rename ${qname}: it is named in a position with no rewritable identifier (${unpositioned.join(", ")}). Edit those definitions first.`,
    );
  }
  if (own === undefined) {
    throw new Error(`rename aborted: cannot locate "${old}" on its own definition line`);
  }

  const next = respell(store.lines, [own, ...refs], old, newName, "rename").join("\n");
  return commit(path, next, "rename", () =>
    logOp(path, { op: "rename", layer: entry.layer, name: old, newName }),
  );
}

/**
 * Where `entry`'s name is spelled as its name: on its own definition line
 * (`own`, undefined when it is not found there), and in each reference to it
 * from a definition in `store` (`refs`). These are the positions `rename`
 * rewrites, and nothing else, so a record field, a word in a comment, a string
 * literal and a loop variable that merely share the spelling are left alone by
 * construction rather than by a filter that has to anticipate them.
 * `unpositioned` names each definition that refers to `entry` with no
 * identifier of its own, which no rewrite can reach: a test's
 * `{slots: {count: 0}}` key is a record key, not a token the AST points at.
 */
function nameSites(
  store: Store,
  entry: DefEntry,
): { own: Pos | undefined; refs: Pos[]; unpositioned: string[] } {
  const refs: Pos[] = [];
  const unpositioned: string[] = [];
  for (const e of store.defs) {
    const from = `${e.layer}.${e.name}`;
    let reachable = true;
    for (const r of referenceSites(store, from)) {
      if (r.layer !== entry.layer || r.name !== entry.name) continue;
      if (r.pos) refs.push(r.pos);
      else reachable = false;
    }
    if (!reachable) unpositioned.push(from);
  }
  return { own: defNamePos(store, entry, entry.name), refs, unpositioned };
}

/**
 * `lines` with the name `from` at each of `sites` spelled `to` instead, right
 * to left within a line so that earlier columns keep their positions. Throws,
 * naming `verb`, when a site is past the end of `lines` or does not spell
 * `from`.
 */
function respell(
  lines: readonly string[],
  sites: readonly Pos[],
  from: string,
  to: string,
  verb: string,
): string[] {
  const out = lines.slice();
  const byLine = new Map<number, number[]>();
  for (const p of sites) {
    const cols = byLine.get(p.line) ?? [];
    cols.push(p.col);
    byLine.set(p.line, cols);
  }
  for (const [line, cols] of byLine) {
    const text = out[line - 1];
    if (text === undefined) {
      throw new Error(`${verb} aborted: reference at line ${line} is past the end of the file`);
    }
    let next = text;
    for (const col of [...new Set(cols)].sort((a, b) => b - a)) {
      const at = col - 1;
      if (next.slice(at, at + from.length) !== from) {
        throw new Error(
          `${verb} aborted: expected "${from}" at ${line}:${col} but found "${next.slice(at, at + from.length)}"`,
        );
      }
      next = next.slice(0, at) + to + next.slice(at + from.length);
    }
    out[line - 1] = next;
  }
  return out;
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
 *
 * Undefined when the name is not found on the keyword's line. The content hash
 * leaves out the same position `rename` rewrites, so it reads it here too.
 */
function defNamePos(store: Store, entry: DefEntry, name: string): Pos | undefined {
  const line = store.lines[entry.range.startLine - 1] ?? "";
  const keywordCol = (entry.def as { pos?: Pos }).pos?.col ?? 1;
  const from = keywordCol - 1 + entry.layer.length;
  const at = line.indexOf(name, from);
  return at < 0 ? undefined : { line: entry.range.startLine, col: at + 1 };
}

/**
 * Partial edit of a definition body. The patch is a JSON object in one of two
 * shapes (both from the spec §9.6.1 auto-patch precedent):
 *
 *   { "find": "...", "replace": "..." }            — replace one occurrence
 *   { "body:<line>": "replace 'a' -> 'b'" }       — per-line replacement
 *
 * The edit is confined to the target definition's source range; matches
 * outside the range are not touched. Either shape is rejected, with nothing
 * written, when the text it replaces is not where it says: in the definition
 * for `find`, on line `<line>` of it for a per-line patch.
 */
export function editDef(path: string, qname: string, patch: unknown): string {
  requireSourceFile(path);
  enforceLock(path, qname);
  return withWriteLock(path, () => editDefLocked(path, qname, patch));
}

function editDefLocked(path: string, qname: string, patch: unknown): string {
  enforceLock(path, qname);
  const store = load(path);
  const entry = store.byQName.get(qname);
  if (!entry) throw new Error(`Definition "${qname}" not found`);
  const prev = bodyOf(store, entry, "edit");
  const bodyStart = entry.range.startLine - 1;
  const bodyEnd = entry.range.endLine;
  const before = store.lines.slice(0, bodyStart);
  const target = store.lines.slice(bodyStart, bodyEnd);
  const after = store.lines.slice(bodyEnd);
  let updated: string[];
  if (isFindReplacePatch(patch)) {
    const joined = target.join("\n");
    updated = replaceFirst(joined, patch.find, patch.replace, `in ${qname}`).split("\n");
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
      updated[lineIdx] = replaceFirst(cur, from!, to!, `on body line ${lineIdx + 1} of ${qname}`);
    }
  } else {
    throw new Error(
      `edit rejected: patch must be {find,replace} or {body:<n>: "replace 'a' -> 'b'"}`,
    );
  }
  const next = [...before, ...updated, ...after].join("\n");
  return commit(path, next, "edit", () => {
    // Record the post-edit body, so `depends-on` is computable and a later op
    // that records no body of its own can fall back to it, and the body the
    // edit replaced, which `patch revert` writes back. Both are bodies as
    // `assemble` takes them, so writing either back round-trips.
    const updatedStore = load(path);
    const updatedEntry = updatedStore.byQName.get(qname);
    const newBody = updatedEntry ? bodyOf(updatedStore, updatedEntry, "edit") : undefined;
    return logOp(path, {
      op: "edit",
      layer: entry.layer,
      name: entry.name,
      patch,
      ...(newBody !== undefined ? { body: newBody } : {}),
      prev,
    });
  });
}

/**
 * `text` with its first `from` replaced by `to`, for both `edit` patch shapes.
 * Throws when `from` is not in `text`: there is nothing to replace, and an edit
 * that went ahead without it would be reported and logged as applied. `where`
 * names the text searched, for the message.
 */
function replaceFirst(text: string, from: string, to: string, where: string): string {
  if (!text.includes(from)) {
    throw new Error(`edit rejected: ${JSON.stringify(from)} not present ${where}`);
  }
  // Function replacer so that `$&` / `$$` / `` $` `` / `$'` in the replacement
  // string aren't interpreted by String.prototype.replace.
  return text.replace(from, () => to);
}

/**
 * Inverse of `assemble` for a layer without a header: strip the layer-specific
 * opener (`slot <name> :`, `theme <name> =`, …) so we recover the "logical
 * body" written by the user and stored in op log entries. `bodyOf` reads a
 * tile's or a type's off its tokens instead.
 */
function extractBody(layer: string, name: string, source: string): string {
  const n = escapeRegExp(name);
  const text = source;
  switch (layer) {
    case "theme":
    case "motion":
    case "test":
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
  requireSourceFile(path);
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
    // Put back what was there before, unvalidated: it is the file as it was.
    try {
      atomicWriteFileSync(path, original);
      // A bundle that started without an op log deletes the one the partial
      // apply created instead of leaving an empty one behind.
      if (originalLog === null) rmSync(opLogPath(path), { force: true });
      else atomicWriteFileSync(opLogPath(path), originalLog);
    } catch (r) {
      throw new Error(
        `patch apply rejected: ${messageOf(e)}; restoring ${path} and its op log failed too (${messageOf(r)}), so they may hold part of the bundle`,
        { cause: e },
      );
    }
    throw new Error(`patch apply rejected: ${messageOf(e)}`, { cause: e });
  }
}

function applyOne(path: string, op: RawOp): string {
  const problem = opShapeProblem(op);
  if (problem !== undefined) throw new Error(problem);
  switch (op.op) {
    case "add":
      if (op.body === undefined) throw new Error("add op missing body");
      return addDefs(path, [{ layer: op.layer, name: op.name, body: op.body }, ...(op.with ?? [])]);
    case "replace":
      if (op.body === undefined) throw new Error("replace op missing body");
      return replaceDef(path, `${op.layer}.${op.name}`, op.body).opId;
    case "edit":
      if (op.patch === undefined) throw new Error("edit op missing patch");
      return editDef(path, `${op.layer}.${op.name}`, op.patch);
    case "rename":
      if (!op.newName) throw new Error("rename op missing newName");
      return renameDef(path, `${op.layer}.${op.name}`, op.newName);
    case "remove": {
      const main = `${op.layer}.${op.name}`;
      if (op.removed === undefined) return removeDef(path, main, op.cascade ?? false).opId;
      // `opShapeProblem` checked that the recorded set starts with `main`.
      const [, ...rest] = op.removed;
      return removeSet(path, load(path), [main, ...rest], true).opId;
    }
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
  requireSourceFile(path);
  return withWriteLock(path, () => patchRevertLocked(path, opId));
}

function patchRevertLocked(path: string, opId: string): string {
  const log = readOpLog(path);
  const idx = log.findIndex((e) => e["op-id"] === opId);
  if (idx === -1) throw new Error(`patch revert: op-id "${opId}" not found in log`);
  const target = log[idx]!;
  const own = `${target.layer}.${target.name}`;
  // Each definition the op touched is acted on under the name it has now. One
  // that a later op removed is gone, and whatever has its name now is another
  // definition, which the revert must not touch.
  const namesNow = (did: string, qnames: readonly string[]): string[] => {
    const followed = qnames.map((q) => ({ q, ...nameNow(log, idx, q) }));
    const gone = followed.flatMap((f) => ("endedBy" in f ? [{ q: f.q, by: f.endedBy }] : []));
    if (gone.length > 0) {
      const how = gone.map(({ q, by }) =>
        by.op === "remove"
          ? `${by["op-id"]} removed ${q}`
          : `${by["op-id"]} gave ${q} to another definition`,
      );
      throw new Error(
        `patch revert: ${opId} ${did} ${gone.map((g) => g.q).join(", ")}, which ${gone.length === 1 ? "is" : "are"} no longer in the file: ${how.join(", ")}; nothing was written`,
      );
    }
    return followed.map((f) => ("now" in f ? f.now : f.q));
  };
  const nameOf = (did: string, qname: string): string => namesNow(did, [qname])[0]!;
  switch (target.op) {
    case "add": {
      // Inverse of add = remove. An add that restored a cascade removes exactly
      // the set it added — not what references the named definition now.
      const added = [own, ...(target.with ?? []).map((d) => `${d.layer}.${d.name}`)];
      const [main, ...rest] = namesNow("added", added);
      if (target.with === undefined) return removeDef(path, main!, false).opId;
      return removeSet(path, load(path), [main!, ...rest], true).opId;
    }
    case "remove": {
      // Inverse of remove = add, of every definition the op removed — a
      // cascade is one op (§9.4.1), so its inverse is one too.
      return addDefs(path, removedDefs(log, idx, opId));
    }
    case "replace": {
      // The body the op replaced, as it recorded it. One logged before ops
      // recorded it falls back to the last body the log has for the
      // definition, under whichever name it had then.
      const prev = recordedPrev(target) ?? priorBody(log, idx, target.layer, target.name);
      if (prev === undefined) throw new Error(`patch revert: no prior body found for ${own}`);
      const now = nameOf("replaced", own);
      return replaceDefLocked(path, now, bodyFor(prev, now)).opId;
    }
    case "edit": {
      // As for `replace`: the recorded body, or the log's best guess at it.
      const prev = recordedPrev(target) ?? priorBody(log, idx, target.layer, target.name);
      if (prev === undefined) {
        throw new Error(`patch revert: cannot reconstruct prior body for edit of ${own}`);
      }
      const now = nameOf("edited", own);
      return replaceDefLocked(path, now, bodyFor(prev, now)).opId;
    }
    case "rename": {
      if (!target.newName) throw new Error("patch revert: rename op missing newName");
      const now = nameOf(`renamed ${own} to`, `${target.layer}.${target.newName}`);
      return renameDef(path, now, target.name);
    }
    default:
      throw new Error(`patch revert: unsupported op kind "${target.op}"`);
  }
}

/**
 * The definitions a `remove` op deleted, with their bodies. A remove records
 * them itself (`bodies`). One logged before it did falls back to the last body
 * the log recorded for each name before the remove; if any is missing, nothing
 * is restored rather than part of the op.
 */
function removedDefs(
  log: OpLogEntry[],
  idx: number,
  opId: string,
): readonly [DefSpec, ...DefSpec[]] {
  const target = log[idx]!;
  const writable = (d: DefSpec): DefSpec => ({ ...d, body: bodyFor(d, `${d.layer}.${d.name}`) });
  const [recorded, ...others] = target.bodies ?? [];
  if (recorded !== undefined) return [writable(recorded), ...others.map(writable)];
  if (target.cascade === true && target.removed === undefined) {
    throw new Error(
      `patch revert: ${opId} is a cascade that does not record what it removed, so what to restore is unknown; nothing was written`,
    );
  }
  const removed = target.removed ?? [`${target.layer}.${target.name}`];
  const defs: DefSpec[] = [];
  const missing: string[] = [];
  for (const q of removed) {
    const [layer, name] = splitQname(q);
    const logged = priorBody(log, idx, layer, name);
    if (logged === undefined) missing.push(q);
    else defs.push({ layer, name, body: bodyFor(logged, q) });
  }
  const [first, ...rest] = defs;
  if (missing.length > 0 || first === undefined) {
    throw new Error(
      `patch revert: cannot reconstruct the body of ${missing.join(", ")} removed by ${opId}; nothing was written`,
    );
  }
  return [first, ...rest];
}

/**
 * `spec`, refused when its body is a whole definition: a body never starts
 * with its own `<layer> <name>`, since no right-hand side or header starts
 * with a definition keyword. Written back, it would read `tile X = tile X …`.
 * Earlier versions logged the body of a tile or a type with clauses or
 * parameters that way.
 */
function writableBody(spec: DefSpec): DefSpec {
  const opener = new RegExp(`^\\s*${spec.layer}\\s+${escapeRegExp(spec.name)}(?![A-Za-z0-9_-])`);
  if (opener.test(spec.body)) {
    throw new Error(
      `patch revert: the body logged for ${spec.layer}.${spec.name} starts with "${spec.layer} ${spec.name}", so it is a whole definition rather than a body and cannot be written back (earlier versions logged a tile's or a type's body that way when it had clauses or parameters); nothing was written`,
    );
  }
  return spec;
}

/**
 * A body the log recorded for a definition under the name it had then
 * (`logged`), to write back to that definition, called `qname` now. Refused
 * when it is a whole definition (`writableBody`). A body logged under another
 * name spells that name wherever the definition names itself: on its own line
 * and in each reference to itself, as a recursive type or fn has. Those are
 * the positions `rename` rewrites, and they are rewritten the same way, so the
 * definition refers to itself, not to whatever has its old name now.
 */
function bodyFor(logged: DefSpec, qname: string): string {
  const { layer, name: from, body } = writableBody(logged);
  const [, to] = splitQname(qname);
  if (from === to) return body;
  const alone = loadSource(assemble(layer, from, body));
  const entry = alone.byQName.get(`${layer}.${from}`);
  const sites = entry === undefined ? undefined : nameSites(alone, entry);
  if (sites?.own === undefined || sites.unpositioned.length > 0) {
    throw new Error(
      `patch revert: cannot rename ${layer}.${from} to ${to} in the body the log recorded for it; nothing was written`,
    );
  }
  const lines = respell(alone.lines, [sites.own, ...sites.refs], from, to, "patch revert");
  const renamed = loadSource(lines.join("\n"));
  return bodyOf(renamed, renamed.byQName.get(qname)!, "patch revert");
}

/** The body a `replace` or an `edit` recorded its definition had before it, under the name it had then. */
function recordedPrev(op: OpLogEntry): DefSpec | undefined {
  return op.prev === undefined ? undefined : { layer: op.layer, name: op.name, body: op.prev };
}

/**
 * The last body the log recorded for the definition before op `idx`, under
 * the name the definition had when it was recorded.
 */
function priorBody(
  log: OpLogEntry[],
  idx: number,
  layer: string,
  name: string,
): DefSpec | undefined {
  for (const [e, current] of namesBack(log, idx, `${layer}.${name}`, true)) {
    if (`${e.layer}.${e.name}` === current && typeof e.body === "string") {
      return { layer: e.layer, name: e.name, body: e.body };
    }
    const restored = e.with?.find((d) => `${d.layer}.${d.name}` === current);
    if (restored) return restored;
  }
  return undefined;
}

/**
 * The qualified names a `rename` op moved a definition between; undefined for
 * any other op, and for a rename to the name the definition already had. A
 * name is a label (§9.5.3): history and revert follow a definition through a
 * rename by this one rule rather than by the name an op was logged under.
 */
function renamedBy(op: OpLogEntry): { from: string; to: string } | undefined {
  if (op.op !== "rename" || op.newName === undefined || op.newName === op.name) return undefined;
  return { from: `${op.layer}.${op.name}`, to: `${op.layer}.${op.newName}` };
}

/**
 * Whether `op` takes `qname` from the definition that has it: removes that
 * definition, on its own or in a cascade, or renames it.
 */
function vacates(op: OpLogEntry, qname: string): boolean {
  const removes =
    op.op === "remove" &&
    (`${op.layer}.${op.name}` === qname || op.removed?.includes(qname) === true);
  return removes || renamedBy(op)?.from === qname;
}

/**
 * Whether `op` gives `qname` to a definition: adds it, on its own or in a
 * restore's `with`, or renames one to it.
 */
function fills(op: OpLogEntry, qname: string): boolean {
  const adds =
    op.op === "add" &&
    (`${op.layer}.${op.name}` === qname ||
      op.with?.some((d) => `${d.layer}.${d.name}` === qname) === true);
  return adds || renamedBy(op)?.to === qname;
}

/**
 * The ops before `end` made on one definition, latest first, each with the
 * name the definition had right after it: from `qname` back through each
 * rename that gave the definition its name, to the op that added it, where
 * the walk stops. It stops as well, before it, at an op that took the name
 * from an earlier definition (`vacates`), once this definition is known to
 * have had the name after that op — from the start when `held` says it has
 * `qname` at `end`. Without `held`, such an op met first is this definition's
 * own: the last one called `qname` was removed or renamed.
 */
function* namesBack(
  log: readonly OpLogEntry[],
  end: number,
  qname: string,
  held: boolean,
): Generator<[OpLogEntry, string]> {
  let current = qname;
  let known = held;
  for (let i = end - 1; i >= 0; i--) {
    const e = log[i]!;
    if (known && vacates(e, current)) return;
    yield [e, current];
    const renamed = renamedBy(e);
    if (renamed?.to === current) {
      current = renamed.from;
      known = true;
    } else if (fills(e, current)) {
      return;
    } else if (namesDef(e, current)) {
      known = true;
    }
  }
}

/**
 * Where the definition called `qname` right after op `idx` is now: under the
 * name each later rename of it gave it (`now`), or gone, with the op that
 * ended it (`endedBy`) — one that removed it, or one that gave its name to
 * another definition, which can only have happened once this one had left the
 * file. Whatever has the name after that is another definition.
 */
function nameNow(
  log: readonly OpLogEntry[],
  idx: number,
  qname: string,
): { now: string } | { endedBy: OpLogEntry } {
  let current = qname;
  for (const e of log.slice(idx + 1)) {
    const renamed = renamedBy(e);
    if (renamed?.from === current) current = renamed.to;
    else if (vacates(e, current) || fills(e, current)) return { endedBy: e };
  }
  return { now: current };
}

/** Whether `op` names `qname`: as its own definition, in a cascade's `removed`, or in a restore's `with`. */
function namesDef(op: OpLogEntry, qname: string): boolean {
  return (
    `${op.layer}.${op.name}` === qname ||
    op.removed?.includes(qname) === true ||
    op.with?.some((d) => `${d.layer}.${d.name}` === qname) === true
  );
}

/**
 * Return the op log entries that touched a qname, in chronological order: the
 * ops that name it (its own, a cascade's `removed`, a restore's `with`), and,
 * for the definition that has the name now (or last had it), the ops made on
 * it under earlier names, back to the op that added it, and each rename that
 * moved it. After `rename slot.count total`, the history of `slot.total`
 * therefore starts with the ops on `slot.count`, and `slot.count` keeps them
 * too, as that name's history. The ops on a definition removed from
 * `slot.count` before this one was added are that name's history only.
 */
export function viewHistory(path: string, qname: string): OpLogEntry[] {
  const log = readOpLog(path);
  const followed = new Set<OpLogEntry>();
  for (const [e, current] of namesBack(log, log.length, qname, false)) {
    if (namesDef(e, current) || renamedBy(e)?.to === current) followed.add(e);
  }
  return log.filter((e) => namesDef(e, qname) || followed.has(e));
}

/**
 * Content hash of a definition (§9.5.1): sha256 of its canonical form mixed
 * with the hashes of its direct deps, which carry their own deps' hashes. PoC
 * stand-in for the blake3-based hash the spec names. Shared with
 * `computeDependsOn` so `view --hash <q>` and the `@h:` digest in another op's
 * `depends-on` line up.
 *
 * No definition's name is part of it (§9.5.1): see `canonicalForm`. A rename
 * therefore leaves the hash of the renamed definition, and of every definition
 * that references it, as it was, and so does a change of whitespace or
 * comments. Definitions that refer to each other in a cycle are hashed as one
 * unit (`hashCycle`), so a member's hash does not depend on which member is
 * reached first.
 *
 * It does not follow §9.5.1's formula in one respect: the fields of a record
 * are hashed in the order they are written, not alphabetized (`canonicalForm`),
 * so reordering them changes the hash.
 */
export function viewHash(store: Store, qname: string): string {
  return computeHash(store, qname, new Map());
}

function computeHash(store: Store, qname: string, memo: Map<string, string>): string {
  const cached = memo.get(qname);
  if (cached !== undefined) return cached;
  const entry = store.byQName.get(qname);
  if (!entry) {
    const h = hashBody(qname);
    memo.set(qname, h);
    return h;
  }
  const cycle = cycles(store).get(qname);
  if (cycle !== undefined) {
    hashCycle(store, cycle, memo);
    return memo.get(qname)!;
  }
  // Outside a cycle, nothing `qname` refers to refers back to it, so the
  // recursion ends.
  const canonical = canonicalForm(store, entry, (target, layer) =>
    hashLabel(store, target, layer, memo),
  );
  // Ordered by hash, not by name, so that a rename of a dep cannot reorder them.
  const depPart = directDeps(store, qname)
    .map((d) => computeHash(store, d, memo))
    .sort()
    .join(":");
  const h = hashBody(`${canonical}|${depPart}`);
  memo.set(qname, h);
  return h;
}

/** How a reference to `target` reads in a canonical form: its layer and hash. */
function hashLabel(store: Store, target: string, layer: string, memo: Map<string, string>): string {
  return `@${layer}:${computeHash(store, target, memo)}`;
}

/**
 * Hash the members of one cycle of references (two or more definitions) as
 * one unit, into `memo`. A reference from one member to another cannot count
 * as its target's hash, which is what is being computed. So each member is
 * read twice: first with every such reference as its target's layer alone,
 * then with it as the hash of the target's first reading too, so that which
 * member refers to which counts. A member's hash is its second reading, with
 * the hash of every member's second reading and the hashes of what it refers
 * to outside the cycle. Nothing in it depends on the order in which members
 * are reached, or on their names.
 */
function hashCycle(store: Store, members: readonly string[], memo: Map<string, string>): void {
  const inCycle = new Set(members);
  const read = (within: (target: string, layer: string) => string): Map<string, string> =>
    new Map(
      members.map((m) => [
        m,
        canonicalForm(store, store.byQName.get(m)!, (target, layer) =>
          inCycle.has(target) ? within(target, layer) : hashLabel(store, target, layer, memo),
        ),
      ]),
    );
  const first = read((_target, layer) => `@cycle:${layer}`);
  const second = read((target, layer) => `@cycle:${layer}:${hashBody(first.get(target)!)}`);
  const unit = hashBody(JSON.stringify([...second.values()].sort()));
  for (const m of members) {
    const depPart = [
      unit,
      ...directDeps(store, m)
        .filter((d) => !inCycle.has(d))
        .map((d) => computeHash(store, d, memo)),
    ]
      .sort()
      .join(":");
    memo.set(m, hashBody(`${second.get(m)}|${depPart}`));
  }
}

const cyclesByStore = new WeakMap<Store, Map<string, readonly string[]>>();

/**
 * The cycles of references among a store's definitions: each definition in
 * one, keyed to all the members of its cycle, itself included. They are the
 * strongly connected components of the reference graph (Tarjan's algorithm)
 * with two or more members; a definition that refers only to itself is in
 * none, as it reads its references to itself as `@self`.
 */
function cycles(store: Store): Map<string, readonly string[]> {
  const known = cyclesByStore.get(store);
  if (known !== undefined) return known;
  const out = new Map<string, readonly string[]>();
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visit = (q: string): void => {
    const at = order.size;
    order.set(q, at);
    low.set(q, at);
    stack.push(q);
    onStack.add(q);
    for (const d of directDeps(store, q)) {
      if (!order.has(d)) {
        visit(d);
        low.set(q, Math.min(low.get(q)!, low.get(d)!));
      } else if (onStack.has(d)) {
        low.set(q, Math.min(low.get(q)!, order.get(d)!));
      }
    }
    if (low.get(q) !== at) return;
    const members: string[] = [];
    let m: string;
    do {
      m = stack.pop()!;
      onStack.delete(m);
      members.push(m);
    } while (m !== q);
    if (members.length > 1) for (const member of members) out.set(member, members);
  };
  for (const e of store.defs) {
    const q = `${e.layer}.${e.name}`;
    if (!order.has(q)) visit(q);
  }
  cyclesByStore.set(store, out);
  return out;
}

/**
 * A definition's tokens, as its hash reads them. Whitespace and comments are
 * not tokens. The positions `rename` rewrites are not spelled by name: the
 * definition's own name and every reference to itself are `@self`, and every
 * other reference is what `label` reads for the definition it names, its
 * layer and hash. Everything else is kept as written, local names included,
 * and so is the order of a record's fields: §9.5.1's formula alphabetizes
 * them, and this does not, a known deviation.
 */
function canonicalForm(
  store: Store,
  entry: DefEntry,
  label: (target: string, layer: string) => string,
): string {
  const qname = `${entry.layer}.${entry.name}`;
  const key = (p: Pos): string => `${p.line}:${p.col}`;
  const labels = new Map<string, string>();
  const own = defNamePos(store, entry, entry.name);
  if (own !== undefined) labels.set(key(own), "@self");
  for (const r of referenceSites(store, qname)) {
    if (!r.pos) continue;
    const target = `${r.layer}.${r.name}`;
    labels.set(key(r.pos), target === qname ? "@self" : label(target, r.layer));
  }
  // Lexed on its own, so a token's line is counted from the definition's first.
  const offset = entry.range.startLine - 1;
  const text = store.lines.slice(offset, entry.range.endLine).join("\n");
  const out: unknown[] = [];
  for (const t of lex(text)) {
    if (t.kind === "eof") continue;
    const at = labels.get(key({ line: t.pos.line + offset, col: t.pos.col }));
    out.push(at ?? [t.kind, t.kind === "num" ? t.raw : t.value]);
  }
  return JSON.stringify(out);
}

/**
 * Why `pattern` cannot be locked, whatever the lock file holds, if it cannot:
 * it names no glob. Refused, so that an agent has an entry in the lock file
 * exactly when it holds a glob. `lock` asks this before it reads anything, and
 * reports it as an argument of the wrong shape.
 */
export function lockPatternProblem(pattern: string): string | undefined {
  if (patternGlobs(pattern).length > 0) return undefined;
  return `lock pattern "${pattern}" names no glob. Give one or more, comma-separated, like "slot.todos*,reducer.todo-*".`;
}

/**
 * Grant `agentId` the globs of `pattern`, or throw: when the pattern names no
 * glob (`lockPatternProblem`), when there is no file at `path`
 * (`requireSourceFile`), or when one of its globs overlaps a pattern another
 * agent holds (`lockConflict`). A refusal leaves the lock file as it was, and
 * writes none where there was none.
 */
export function lockDef(path: string, agentId: string, pattern: string): void {
  const problem = lockPatternProblem(pattern);
  if (problem !== undefined) throw new Error(problem);
  requireSourceFile(path);
  withWriteLock(path, () => lockDefLocked(path, agentId, pattern));
}

/**
 * The refusal for the first of `globs` that overlaps a pattern another agent
 * holds, if any: some name could match both (`globsOverlap`). If granted, the
 * glob would leave each agent refused by the other's lock on that name, so
 * neither could edit it. Only other agents' patterns are compared.
 */
function lockConflict(
  locks: LockFile,
  agentId: string,
  globs: readonly string[],
): string | undefined {
  for (const glob of globs) {
    for (const e of locks.entries) {
      if (e.agent === agentId) continue;
      for (const pat of e.patterns) {
        if (patternGlobs(pat).some((held) => globsOverlap(glob, held))) {
          return `lock conflict: "${glob}" overlaps "${pat}", held by ${e.agent}. None of the request was granted: ${e.agent} has to unlock first, or ask for a glob that does not overlap "${pat}".`;
        }
      }
    }
  }
  return undefined;
}

function lockDefLocked(path: string, agentId: string, pattern: string): void {
  const locks = readLocks(path);
  const patterns = patternGlobs(pattern);
  const conflict = lockConflict(locks, agentId, patterns);
  if (conflict !== undefined) throw new Error(conflict);
  const existing = locks.entries.find((e) => e.agent === agentId);
  if (existing) {
    for (const p of patterns) if (!existing.patterns.includes(p)) existing.patterns.push(p);
  } else {
    locks.entries.push({ agent: agentId, patterns });
  }
  writeLocks(path, locks);
}

/**
 * Release every pattern `agentId` holds, or throw: when there is no file at
 * `path` (`requireSourceFile`), or when the agent holds none. A refusal leaves
 * the lock file as it was, and writes none where there was none.
 */
export function unlockDef(path: string, agentId: string): void {
  requireSourceFile(path);
  withWriteLock(path, () => unlockDefLocked(path, agentId));
}

function unlockDefLocked(path: string, agentId: string): void {
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

/** What follows the name: nothing before `(` (`fn f(x: Int)`, `type Box(T)`), a space otherwise. */
const afterName = (rest: string): string => `${rest.startsWith("(") ? "" : " "}${rest}`;

function assemble(layer: string, name: string, body: string): string {
  // Each layer has its canonical opener. Keep this regenerable from the AST
  // later; for the PoC we lean on tiny templates.
  if (statesHeader(layer, body)) return `${layer} ${name}${afterName(body)}`;
  switch (layer) {
    case "type":
    case "tile":
    case "theme":
    case "motion":
    case "test":
      return `${layer} ${name} = ${body}`;
    case "slot":
      return `slot ${name} : ${body}`;
    case "effect":
      return `effect ${name} ${body}`;
    case "reducer":
      return `reducer ${name} ${body}`;
    case "fn":
      return `fn ${name}${afterName(body)}`;
    case "app":
      return `app ${name}\n${body}`;
    default:
      throw new Error(`Unknown layer "${layer}"`);
  }
}
