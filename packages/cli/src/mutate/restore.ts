import { readFileSync } from "node:fs";
import { joinLines, load, loadSource, type Store, spliceLines } from "../store.ts";
import { withWriteLock } from "../write-lock.ts";
import { commit } from "./commit.ts";
import { bodyOf, definitionText } from "./definition-text.ts";
import { enforceLock } from "./locks.ts";
import { type DefSpec, logOp } from "./op-log.ts";

/**
 * Where a definition's text goes back: `gap` lines after the end of the definition `after` names,
 * or after the start of the file without one.
 */
export type Place = { after?: string; gap: number };

/** A definition a `remove` deleted, to write back as the text it recorded. */
export type RestoredDef = DefSpec & {
  text: string;
  /** `undefined` when the definition it followed is gone: it then goes at the end of the file. */
  place: Place | undefined;
};

/** Writes `text` in place of `qname`'s definition, and logs it as a `replace`. */
export function replaceText(path: string, qname: string, text: string): string {
  enforceLock(path, qname);
  return withWriteLock(path, () => {
    enforceLock(path, qname);
    const store = load(path);
    const entry = store.byQName.get(qname);
    if (!entry) throw new Error(`Definition "${qname}" not found`);
    const prev = definitionText(store, entry);
    const next = spliceLines(
      store.source,
      entry.range.startLine,
      entry.range.endLine,
      text.split("\n"),
    );
    return commit(path, next, "replace", () => {
      const written = load(path);
      const now = written.byQName.get(qname);
      const body = now === undefined ? undefined : bodyOf(written, now, "replace");
      return logOp(path, {
        op: "replace",
        layer: entry.layer,
        name: entry.name,
        ...(body !== undefined ? { body } : {}),
        prev,
      });
    });
  });
}

/** Writes each definition back where it stood, and logs one `add` of the first `with` the rest. */
export function restoreDefs(path: string, defs: readonly [RestoredDef, ...RestoredDef[]]): string {
  const [main, ...rest] = defs;
  const qname = `${main.layer}.${main.name}`;
  enforceLock(path, qname);
  return withWriteLock(path, () => {
    enforceLock(path, qname);
    let next = readFileSync(path, "utf8");
    for (const d of placeOrder(defs)) next = placeText(next, d);
    const spec = ({ layer, name, body }: DefSpec): DefSpec => ({ layer, name, body });
    return commit(path, next, "add", () =>
      logOp(path, {
        op: "add",
        ...spec(main),
        ...(rest.length > 0 ? { with: rest.map(spec) } : {}),
      }),
    );
  });
}

/** Each definition after the one it followed, when that is one of them too. */
function placeOrder(defs: readonly RestoredDef[]): RestoredDef[] {
  const pending = [...defs];
  const out: RestoredDef[] = [];
  while (pending.length > 0) {
    const ready = pending.findIndex(
      (d) => !pending.some((o) => d.place?.after === `${o.layer}.${o.name}`),
    );
    out.push(...pending.splice(Math.max(ready, 0), 1));
  }
  return out;
}

function placeText(source: string, d: RestoredDef): string {
  const store = loadSource(source);
  const line = d.place === undefined ? undefined : lineFor(store, d.place);
  if (line === undefined) {
    return (
      source + joinLines(source, [source.endsWith("\n") ? `\n${d.text}\n` : `\n\n${d.text}\n`])
    );
  }
  // Past the last line, which has no line break after it for the text to follow.
  if (line > store.lines.length) return source + joinLines(source, ["", d.text]);
  return spliceLines(source, line, line - 1, d.text.split("\n"));
}

/** The line the text starts on, short of the next definition; `undefined` when `after` is gone. */
function lineFor(store: Store, place: Place): number | undefined {
  const end = place.after === undefined ? 0 : store.byQName.get(place.after)?.range.endLine;
  if (end === undefined) return undefined;
  const next = store.defs.find((e) => e.range.startLine > end)?.range.startLine;
  return Math.min(end + place.gap + 1, next ?? store.lines.length + 1);
}
