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
  type Store,
  viewDef,
} from "./store.ts";
import { atomicWriteFileSync, withWriteLock } from "./write-lock.ts";

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
  bodies?: DefSpec[];
  with?: DefSpec[];
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

function validate(
  path: string,
  before: string,
  src: string,
): { ok: true } | { ok: false; message: string } {
  try {
    const program = parse(lex(src));
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

function enforceLock(path: string, qname: string): void {
  const locked = lockViolation(path, [qname]);
  if (locked !== undefined) throw new Error(locked);
}

export type EditReport =
  | { op: "add" | "edit"; qname: string; opId: string }
  | { op: "replace"; qname: string; opId: string; dropped?: readonly string[] }
  | { op: "rename"; qname: string; newName: string; opId: string }
  | { op: "remove"; qname: string; opId: string; removed: RemovedNames };

export type RemovedNames = [requested: string, ...cascaded: string[]];

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
  enforceLock(path, `${layer}.${name}`);
  return withWriteLock(path, () => addDefs(path, [{ layer, name, body }]));
}

function addDefs(path: string, defs: readonly [DefSpec, ...DefSpec[]]): string {
  for (const d of defs) {
    if (!isDefinitionName(d.name)) {
      throw new Error(
        `add rejected: "${d.name}" is not one identifier, so it cannot name a definition (a tile's clauses and a type's parameters go at the start of the body); nothing was written`,
      );
    }
  }
  enforceLock(path, `${defs[0].layer}.${defs[0].name}`);
  const src = readFileSync(path, "utf8");
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

export function replaceDef(
  path: string,
  qname: string,
  body: string,
): { opId: string; dropped: string[] } {
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

const HEADER_START: ReadonlyMap<string, RegExp> = new Map([
  ["tile", /^\s*(?:=|[A-Za-z_][A-Za-z0-9_-]*\s*=)/],
  ["type", /^\s*[(=]/],
]);

function statesHeader(layer: string, body: string): boolean {
  return HEADER_START.get(layer)?.test(body) ?? false;
}

function withHeader(layer: string, body: string, header: () => string): string {
  return !HEADER_START.has(layer) || statesHeader(layer, body) ? body : `${header()}${body}`;
}

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

function bodyOf(store: Store, entry: DefEntry, verb: string): string {
  if (HEADER_START.has(entry.layer)) {
    const { text, from } = headerSpan(store, entry, verb);
    return text.slice(from).trimEnd();
  }
  return extractBody(entry.layer, entry.name, viewDef(store, `${entry.layer}.${entry.name}`) ?? "");
}

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

export const CASCADE_HELP =
  "also remove its dependents: every definition that references it, directly or transitively, which can include the app";

/** Removes `qname`, plus everything that references it when `cascade`. */
export function removeDef(
  path: string,
  qname: string,
  cascade: boolean,
): { opId: string; removed: RemovedNames } {
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

function defNamePos(store: Store, entry: DefEntry, name: string): Pos | undefined {
  const line = store.lines[entry.range.startLine - 1] ?? "";
  const keywordCol = (entry.def as { pos?: Pos }).pos?.col ?? 1;
  const from = keywordCol - 1 + entry.layer.length;
  const at = line.indexOf(name, from);
  return at < 0 ? undefined : { line: entry.range.startLine, col: at + 1 };
}

export function editDef(path: string, qname: string, patch: unknown): string {
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

function replaceFirst(text: string, from: string, to: string, where: string): string {
  if (!text.includes(from)) {
    throw new Error(`edit rejected: ${JSON.stringify(from)} not present ${where}`);
  }
  return text.replace(from, () => to);
}

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
  if (keys.length === 0) return false;
  for (const k of keys) if (!k.startsWith("body:")) return false;
  return true;
}

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
    // Put back what was there before, unvalidated: it is the file as it was.
    try {
      atomicWriteFileSync(path, original);
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

export function patchRevert(path: string, opId: string): string {
  return withWriteLock(path, () => patchRevertLocked(path, opId));
}

function patchRevertLocked(path: string, opId: string): string {
  const log = readOpLog(path);
  const idx = log.findIndex((e) => e["op-id"] === opId);
  if (idx === -1) throw new Error(`patch revert: op-id "${opId}" not found in log`);
  const target = log[idx]!;
  const own = `${target.layer}.${target.name}`;
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
      const added = [own, ...(target.with ?? []).map((d) => `${d.layer}.${d.name}`)];
      const [main, ...rest] = namesNow("added", added);
      if (target.with === undefined) return removeDef(path, main!, false).opId;
      return removeSet(path, load(path), [main!, ...rest], true).opId;
    }
    case "remove": {
      return addDefs(path, removedDefs(log, idx, opId));
    }
    case "replace": {
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

function writableBody(spec: DefSpec): DefSpec {
  const opener = new RegExp(`^\\s*${spec.layer}\\s+${escapeRegExp(spec.name)}(?![A-Za-z0-9_-])`);
  if (opener.test(spec.body)) {
    throw new Error(
      `patch revert: the body logged for ${spec.layer}.${spec.name} starts with "${spec.layer} ${spec.name}", so it is a whole definition rather than a body and cannot be written back (earlier versions logged a tile's or a type's body that way when it had clauses or parameters); nothing was written`,
    );
  }
  return spec;
}

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

function renamedBy(op: OpLogEntry): { from: string; to: string } | undefined {
  if (op.op !== "rename" || op.newName === undefined || op.newName === op.name) return undefined;
  return { from: `${op.layer}.${op.name}`, to: `${op.layer}.${op.newName}` };
}

function vacates(op: OpLogEntry, qname: string): boolean {
  const removes =
    op.op === "remove" &&
    (`${op.layer}.${op.name}` === qname || op.removed?.includes(qname) === true);
  return removes || renamedBy(op)?.from === qname;
}

function fills(op: OpLogEntry, qname: string): boolean {
  const adds =
    op.op === "add" &&
    (`${op.layer}.${op.name}` === qname ||
      op.with?.some((d) => `${d.layer}.${d.name}` === qname) === true);
  return adds || renamedBy(op)?.to === qname;
}

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

export function viewHistory(path: string, qname: string): OpLogEntry[] {
  const log = readOpLog(path);
  const followed = new Set<OpLogEntry>();
  for (const [e, current] of namesBack(log, log.length, qname, false)) {
    if (namesDef(e, current) || renamedBy(e)?.to === current) followed.add(e);
  }
  return log.filter((e) => namesDef(e, qname) || followed.has(e));
}

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

/** What follows the name: nothing before `(` (`fn f(x: Int)`, `type Box(T)`), a space otherwise. */
const afterName = (rest: string): string => `${rest.startsWith("(") ? "" : " "}${rest}`;

function assemble(layer: string, name: string, body: string): string {
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
