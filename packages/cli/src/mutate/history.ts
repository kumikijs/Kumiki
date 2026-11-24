import { LexError, lex, type Token } from "@kumikijs/compiler";
import { loadSource, requireSourceFile } from "../store.ts";
import { withWriteLock } from "../write-lock.ts";
import { assemble, bodyOf, nameSites, respell, splitQname } from "./definition-text.ts";
import { type DefSpec, type OpLogEntry, type OpLogOptions, readOpLog } from "./op-log.ts";
import { type Place, type RestoredDef, replaceText, restoreDefs } from "./restore.ts";
import { addDefs, patchedLines, removeDef, removeSet, renameDef, replaceDef } from "./verbs.ts";

export function patchRevert(path: string, opId: string, options: OpLogOptions = {}): string {
  requireSourceFile(path);
  return withWriteLock(path, () => patchRevertLocked(path, opId, options));
}

// The verbs that log the revert, `replaceText` and `restoreDefs` among them, read the log again
// under the same write lock, without `options`: a line they skip is the one already handed over here.
function patchRevertLocked(path: string, opId: string, options: OpLogOptions): string {
  const log = readOpLog(path, options);
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
      return removeSet(path, [main!, ...rest], true).opId;
    }
    case "remove": {
      const placed = placedDefs(log, idx);
      if (placed !== undefined) return restoreDefs(path, placed);
      return addDefs(path, removedDefs(log, idx, opId));
    }
    case "replace": {
      const prev = recordedPrev(target) ?? priorBody(log, idx, target.layer, target.name);
      if (prev === undefined) throw new Error(`patch revert: no prior body found for ${own}`);
      const now = nameOf("replaced", own);
      return writeBack(path, prev, now, target);
    }
    case "edit": {
      const prev = recordedPrev(target) ?? priorBody(log, idx, target.layer, target.name);
      if (prev === undefined) {
        throw new Error(`patch revert: cannot reconstruct prior body for edit of ${own}`);
      }
      const now = nameOf("edited", own);
      return writeBack(path, prev, now, target);
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
 * The definitions a `remove` deleted, each with where it goes back; `undefined` when the remove did
 * not record their text.
 */
function placedDefs(log: OpLogEntry[], idx: number): [RestoredDef, ...RestoredDef[]] | undefined {
  const recorded = log[idx]!.bodies ?? [];
  const members = new Set(recorded.map((d) => `${d.layer}.${d.name}`));
  const placed: RestoredDef[] = [];
  for (const { layer, name, body, text, after, gap, last } of recorded) {
    if (text === undefined || gap === undefined) return undefined;
    // A member goes back with it, so the one it followed is in the file by then.
    const places =
      after !== undefined && members.has(after)
        ? [{ after, gap }]
        : placesFrom(log, idx, after, gap);
    placed.push({ layer, name, body, text, last: last === true, places });
  }
  const [first, ...rest] = placed;
  return first === undefined ? undefined : [first, ...rest];
}

/**
 * Where a definition goes back, best first: `gap` lines after the one it followed, under the name
 * renames have given that one since. Then, for when that one is gone too, where it stood, as the
 * remove that took it recorded, with the lines before it added to `gap`; and so on.
 */
function placesFrom(
  log: readonly OpLogEntry[],
  idx: number,
  after: string | undefined,
  gap: number,
): Place[] {
  const places: Place[] = [];
  // A log written by hand can name the ones followed in a circle.
  const seen = new Set<string>();
  let at = idx;
  let followed = after;
  let lines = gap;
  while (followed !== undefined) {
    const { now, removedAt } = trail(log, at, followed);
    places.push({ after: now, gap: lines });
    if (removedAt === undefined) return places;
    const stood = log[removedAt]!.bodies?.find((d) => `${d.layer}.${d.name}` === now);
    const key = `${removedAt} ${now}`;
    if (stood?.text === undefined || stood.gap === undefined || seen.has(key)) return places;
    seen.add(key);
    at = removedAt;
    followed = stood.after;
    lines += stood.gap;
  }
  places.push({ gap: lines });
  return places;
}

/**
 * The name `qname` has after the ops from `from` on, following renames, and the last of them that
 * removed it, unless a later one put a definition of that name back.
 */
function trail(
  log: readonly OpLogEntry[],
  from: number,
  qname: string,
): { now: string; removedAt: number | undefined } {
  let now = qname;
  let removedAt: number | undefined;
  for (let i = from; i < log.length; i++) {
    const e = log[i]!;
    const renamed = renamedBy(e);
    if (renamed?.from === now) now = renamed.to;
    else if (e.op === "remove" && vacates(e, now)) removedAt = i;
    else if (fills(e, now)) removedAt = undefined;
  }
  return { now, removedAt };
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

/**
 * Whether `text` opens with the tokens `<layer> <name>`, as a whole definition does and a body does
 * not. Read as tokens, so a comment between the two does not hide them. `theme` and `motion` lex as
 * names, the other layers as keywords.
 */
function isWholeDefinition(layer: string, name: string, text: string): boolean {
  let tokens: Token[];
  try {
    tokens = lex(text);
  } catch (e) {
    if (e instanceof LexError) return false;
    throw e;
  }
  const [opening, named] = tokens;
  return (
    (opening?.kind === "kw" || opening?.kind === "ident") &&
    opening.value === layer &&
    named?.kind === "ident" &&
    named.value === name
  );
}

function writableBody(spec: DefSpec): DefSpec {
  if (isWholeDefinition(spec.layer, spec.name, spec.body)) {
    throw new Error(
      `patch revert: the body logged for ${spec.layer}.${spec.name} starts with "${spec.layer} ${spec.name}", so it is a whole definition rather than a body and cannot be written back (earlier versions logged a tile's or a type's body that way when it had clauses or parameters); nothing was written`,
    );
  }
  return spec;
}

/** The logged body, respelled for the name its definition has now. */
function bodyFor(logged: DefSpec, qname: string): string {
  const { layer, name: from, body } = writableBody(logged);
  const [, to] = splitQname(qname);
  if (from === to) return body;
  const renamed = loadSource(respelled(layer, from, assemble(layer, from, body), to, "body"));
  return bodyOf(renamed, renamed.byQName.get(qname)!, "patch revert");
}

/** A definition's text as the log recorded it, under the name the definition had then. */
type DefText = { layer: string; name: string; text: string };

/** The logged text, respelled for the name its definition has now. */
function textFor(logged: DefText, qname: string): string {
  const { layer, name: from, text } = logged;
  const [, to] = splitQname(qname);
  return from === to ? text : respelled(layer, from, text, to, "text");
}

/** `text`, holding `layer.from` alone, with that name spelled `to` where a rename respells it. */
function respelled(layer: string, from: string, text: string, to: string, what: string): string {
  const alone = loadSource(text);
  const entry = alone.byQName.get(`${layer}.${from}`);
  const sites = entry === undefined ? undefined : nameSites(alone, entry);
  if (sites?.own === undefined || sites.unpositioned.length > 0) {
    throw new Error(
      `patch revert: cannot rename ${layer}.${from} to ${to} in the ${what} the log recorded for it; nothing was written`,
    );
  }
  return respell(alone.lines, [sites.own, ...sites.refs], from, to, "patch revert").join("\n");
}

/**
 * What a `replace` or an `edit` recorded its definition was before it, under the name it had then:
 * its text, or its body when an earlier version logged that instead.
 */
function recordedPrev(op: OpLogEntry): DefSpec | DefText | undefined {
  const { layer, name, prev } = op;
  if (prev === undefined) return undefined;
  return isWholeDefinition(layer, name, prev)
    ? { layer, name, text: prev }
    : { layer, name, body: prev };
}

/** Writes back what the log recorded `op` replaced, for the definition now named `qname`. */
function writeBack(path: string, prev: DefSpec | DefText, qname: string, op: OpLogEntry): string {
  if ("text" in prev) return replaceText(path, qname, textFor(prev, qname), linesWritten(op, prev));
  return replaceDef(path, qname, bodyFor(prev, qname)).opId;
}

/** The lines `op` wrote in place of the definition whose text was `prev`, as far as the log says. */
function linesWritten(op: OpLogEntry, prev: DefText): string[] | undefined {
  if (op.op === "replace") {
    return op.body === undefined ? undefined : assemble(op.layer, op.name, op.body).split(/\r?\n/);
  }
  try {
    const lines = patchedLines(prev.text.split("\n"), `${op.layer}.${op.name}`, op.patch);
    return lines.join("\n").split(/\r?\n/);
  } catch {
    // A patch that does not apply to the text it was logged with: not one an `edit` wrote.
    return undefined;
  }
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

/** Walks the log backwards from `end`, yielding each op with the name `qname` had at that point. */
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

export function viewHistory(path: string, qname: string, options: OpLogOptions = {}): OpLogEntry[] {
  const log = readOpLog(path, options);
  const followed = new Set<OpLogEntry>();
  for (const [e, current] of namesBack(log, log.length, qname, false)) {
    if (namesDef(e, current) || renamedBy(e)?.to === current) followed.add(e);
  }
  return log.filter((e) => namesDef(e, qname) || followed.has(e));
}
