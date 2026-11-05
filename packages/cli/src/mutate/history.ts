import { loadSource } from "../store.ts";
import { escapeRegExp } from "../text.ts";
import { withWriteLock } from "../write-lock.ts";
import { assemble, bodyOf, nameSites, respell, splitQname } from "./definition-text.ts";
import { type DefSpec, type OpLogEntry, type OpLogOptions, readOpLogFor } from "./op-log.ts";
import { addDefs, removeDef, removeSet, renameDef, replaceDef } from "./verbs.ts";

export function patchRevert(path: string, opId: string, options: OpLogOptions = {}): string {
  return withWriteLock(path, () => patchRevertLocked(path, opId, options));
}

// The verbs that log the revert read the log again under the same write lock, without `options`:
// a line they skip is the one already handed over here.
function patchRevertLocked(path: string, opId: string, options: OpLogOptions): string {
  const log = readOpLogFor(path, options).entries;
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
      return addDefs(path, removedDefs(log, idx, opId));
    }
    case "replace": {
      const prev = recordedPrev(target) ?? priorBody(log, idx, target.layer, target.name);
      if (prev === undefined) throw new Error(`patch revert: no prior body found for ${own}`);
      const now = nameOf("replaced", own);
      return replaceDef(path, now, bodyFor(prev, now)).opId;
    }
    case "edit": {
      const prev = recordedPrev(target) ?? priorBody(log, idx, target.layer, target.name);
      if (prev === undefined) {
        throw new Error(`patch revert: cannot reconstruct prior body for edit of ${own}`);
      }
      const now = nameOf("edited", own);
      return replaceDef(path, now, bodyFor(prev, now)).opId;
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

/** The logged body, respelled for the name its definition has now. */
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
  const log = readOpLogFor(path, options).entries;
  const followed = new Set<OpLogEntry>();
  for (const [e, current] of namesBack(log, log.length, qname, false)) {
    if (namesDef(e, current) || renamedBy(e)?.to === current) followed.add(e);
  }
  return log.filter((e) => namesDef(e, qname) || followed.has(e));
}
