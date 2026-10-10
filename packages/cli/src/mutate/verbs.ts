import { existsSync, readFileSync, rmSync } from "node:fs";
import { findReferences, joinLines, load, type Store, spliceLines } from "../store.ts";
import { messageOf } from "../text.ts";
import { atomicWriteFileSync, withWriteLock } from "../write-lock.ts";
import { commit, compareQNames } from "./commit.ts";
import {
  assemble,
  bodyOf,
  headerItems,
  headerOf,
  isDefinitionName,
  nameSites,
  respell,
  withHeader,
} from "./definition-text.ts";
import { enforceLock } from "./locks.ts";
import { type DefSpec, logOp, opLogPath, opShapeProblem, type RawOp } from "./op-log.ts";

export type RemovedNames = [requested: string, ...cascaded: string[]];

export type ReplaceResult = { opId: string; dropped: string[] };

export type RemoveResult = { opId: string; removed: RemovedNames };

export function addDef(path: string, layer: string, name: string, body: string): string {
  return addDefs(path, [{ layer, name, body }]);
}

export function addDefs(path: string, defs: readonly [DefSpec, ...DefSpec[]]): string {
  enforceLock(path, `${defs[0].layer}.${defs[0].name}`);
  return withWriteLock(path, () => addDefsLocked(path, defs));
}

function addDefsLocked(path: string, defs: readonly [DefSpec, ...DefSpec[]]): string {
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
  const next = src + joinLines(src, [src.endsWith("\n") ? `\n${inserted}\n` : `\n\n${inserted}\n`]);
  return commit(path, next, "add", () =>
    logOp(path, { op: "add", ...main, ...(rest.length > 0 ? { with: rest } : {}) }),
  );
}

export function replaceDef(path: string, qname: string, body: string): ReplaceResult {
  enforceLock(path, qname);
  return withWriteLock(path, () => replaceDefLocked(path, qname, body));
}

function replaceDefLocked(path: string, qname: string, body: string): ReplaceResult {
  enforceLock(path, qname);
  const store = load(path);
  const entry = store.byQName.get(qname);
  if (!entry) throw new Error(`Definition "${qname}" not found`);
  const prev = bodyOf(store, entry, "replace");
  const whole = withHeader(entry.layer, body, () => headerOf(store, entry, "replace"));
  const inserted = assemble(entry.layer, entry.name, whole).split(/\r?\n/);
  const next = spliceLines(store.source, entry.range.startLine, entry.range.endLine, inserted);
  const opId = commit(path, next, "replace", () =>
    logOp(path, { op: "replace", layer: entry.layer, name: entry.name, body: whole, prev }),
  );
  const now = headerItems(load(path).byQName.get(qname)?.def);
  return { opId, dropped: headerItems(entry.def).filter((item) => !now.includes(item)) };
}

export const CASCADE_HELP =
  "also remove its dependents: every definition that references it, directly or transitively, which can include the app";

/** Removes `qname`, plus everything that references it when `cascade`. */
export function removeDef(path: string, qname: string, cascade: boolean): RemoveResult {
  enforceLock(path, qname);
  return withWriteLock(path, () => removeDefLocked(path, qname, cascade));
}

function removeDefLocked(path: string, qname: string, cascade: boolean): RemoveResult {
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
  return removeSetLocked(path, store, set, cascade);
}

/** Removes exactly `set`, rejecting it when anything outside it references a member. */
export function removeSet(path: string, set: RemovedNames, cascade: boolean): RemoveResult {
  enforceLock(path, set[0]);
  return withWriteLock(path, () => removeSetLocked(path, load(path), set, cascade));
}

function removeSetLocked(
  path: string,
  store: Store,
  set: RemovedNames,
  cascade: boolean,
): RemoveResult {
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
  // Bottom up, so the line numbers of the entries still to cut stay valid.
  let next = store.source;
  for (const e of [...entries].sort((a, b) => b.range.startLine - a.range.startLine)) {
    next = spliceLines(next, e.range.startLine, e.range.endLine, []);
  }
  const opId = commit(path, next, "remove", () =>
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

  const lines = respell(store.lines, [own, ...refs], old, newName, "rename");
  let next = store.source;
  for (const line of new Set([own, ...refs].map((p) => p.line))) {
    next = spliceLines(next, line, line, lines.slice(line - 1, line));
  }
  return commit(path, next, "rename", () =>
    logOp(path, { op: "rename", layer: entry.layer, name: old, newName }),
  );
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
  const target = store.lines.slice(entry.range.startLine - 1, entry.range.endLine);
  const next = spliceLines(
    store.source,
    entry.range.startLine,
    entry.range.endLine,
    patchedLines(target, qname, patch),
  );
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

function patchedLines(target: readonly string[], qname: string, patch: unknown): string[] {
  if (isFindReplacePatch(patch)) {
    return replaceFirst(target.join("\n"), patch.find, patch.replace, `in ${qname}`).split("\n");
  }
  if (!isPerLinePatch(patch)) {
    throw new Error(
      `edit rejected: patch must be {find,replace} or {body:<n>: "replace 'a' -> 'b'"}`,
    );
  }
  const updated = target.slice();
  for (const [key, instruction] of Object.entries(patch)) {
    const m = /^body:(\d+)$/.exec(key);
    if (!m) throw new Error(`edit rejected: unknown patch key "${key}"`);
    const lineIdx = Number.parseInt(m[1]!, 10) - 1;
    const repl = /^replace\s+'([^']*)'\s*->\s*'([^']*)'$/.exec(String(instruction));
    if (!repl) throw new Error(`edit rejected: cannot parse instruction "${instruction}"`);
    const [, from, to] = repl;
    const cur = updated[lineIdx];
    if (cur === undefined) throw new Error(`edit rejected: body line ${lineIdx + 1} out of range`);
    updated[lineIdx] = replaceFirst(cur, from!, to!, `on body line ${lineIdx + 1} of ${qname}`);
  }
  return updated;
}

function replaceFirst(text: string, from: string, to: string, where: string): string {
  if (!text.includes(from)) {
    throw new Error(`edit rejected: ${JSON.stringify(from)} not present ${where}`);
  }
  return text.replace(from, () => to);
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
  return keys.length > 0 && keys.every((k) => k.startsWith("body:"));
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
      return removeSet(path, [main, ...rest], true).opId;
    }
    default:
      throw new Error(`unknown op kind "${op.op}"`);
  }
}
