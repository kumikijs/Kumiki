import { readFileSync } from "node:fs";
import { joinLines, load, loadSource, type Store, spliceLines } from "../store.ts";
import { withWriteLock } from "../write-lock.ts";
import { commit } from "./commit.ts";
import { bodyOf, withText } from "./definition-text.ts";
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
  /** Whether it ended the file, with no line break after it. */
  last: boolean;
  /** Where it goes: at the first of these with no `after` or one in the file, or else at the end. */
  places: readonly Place[];
};

/**
 * Writes `text` in place of `qname`'s definition, and logs it as a `replace`. When the file still
 * holds `wrote` from the definition's first token, it takes all of that, also the comments and
 * blank lines past the definition's last token.
 */
export function replaceText(
  path: string,
  qname: string,
  text: string,
  wrote: string | undefined,
): string {
  enforceLock(path, qname);
  return withWriteLock(path, () => {
    enforceLock(path, qname);
    const store = load(path);
    const entry = store.byQName.get(qname);
    if (!entry) throw new Error(`Definition "${qname}" not found`);
    const { start, end } = entry.range;
    const held = wrote === undefined ? undefined : joinLines(store.source, [wrote]);
    const to =
      held !== undefined && store.source.startsWith(held, start)
        ? Math.max(end, start + held.length)
        : end;
    const prev = store.source.slice(start, to).split(/\r?\n/).join("\n");
    const next = withText(store, { ...entry, range: { ...entry.range, end: to } }, text);
    return commit(path, next, "replace", () => {
      const written = load(path);
      const now = written.byQName.get(qname);
      if (now === undefined) throw new Error(`the text written back does not define ${qname}`);
      const body = bodyOf(written, now, "replace");
      return logOp(path, { op: "replace", layer: entry.layer, name: entry.name, body, prev }, {});
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
      logOp(
        path,
        {
          op: "add",
          ...spec(main),
          ...(rest.length > 0 ? { with: rest.map(spec) } : {}),
        },
        {},
      ),
    );
  });
}

/** Each definition after the one it followed, when that is one of them too. */
function placeOrder(defs: readonly RestoredDef[]): RestoredDef[] {
  const pending = [...defs];
  const out: RestoredDef[] = [];
  while (pending.length > 0) {
    const ready = pending.findIndex(
      (d) => !pending.some((o) => d.places[0]?.after === `${o.layer}.${o.name}`),
    );
    out.push(...pending.splice(Math.max(ready, 0), 1));
  }
  return out;
}

function placeText(source: string, d: RestoredDef): string {
  const store = loadSource(source);
  for (const place of d.places) {
    const line = lineFor(store, place);
    if (line !== undefined) return writeAt(source, store, line, d);
  }
  return source + joinLines(source, [source.endsWith("\n") ? `\n${d.text}\n` : `\n\n${d.text}\n`]);
}

/** `d`'s text written to start on `line`, with blank lines before it where the file is shorter. */
function writeAt(source: string, store: Store, line: number, d: RestoredDef): string {
  const count = store.lines.length;
  const atEnd = line > count || (line === count && store.lines[count - 1] === "");
  if (!atEnd) return spliceLines(source, line, line - 1, d.text.split("\n"));
  return source + joinLines(source, [`${"\n".repeat(line - count)}${d.text}${d.last ? "" : "\n"}`]);
}

/**
 * The line the text starts on; `undefined` when `after` is gone. When fewer lines than `gap` now
 * lie before the next definition, it goes right above that one and the comment lines over it.
 */
function lineFor(store: Store, place: Place): number | undefined {
  const end = place.after === undefined ? 0 : store.byQName.get(place.after)?.range.endLine;
  if (end === undefined) return undefined;
  const line = end + place.gap + 1;
  const next = store.defs.find((e) => e.range.startLine > end)?.range.startLine;
  if (next === undefined || line <= next) return line;
  let above = next;
  while (above - 1 > end && store.lines[above - 2]?.trim().startsWith("#") === true) above--;
  return above;
}
