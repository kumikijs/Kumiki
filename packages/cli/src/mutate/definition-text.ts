import { type Def, LexError, lex, type Pos, type Token } from "@kumikijs/compiler";
import {
  type DefEntry,
  definitionText,
  joinLines,
  loadSource,
  posInText,
  referenceSites,
  type Store,
  spliceLines,
} from "../store.ts";
import { escapeRegExp } from "../text.ts";

export function isDefinitionName(name: string): boolean {
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

const HEADER_START: ReadonlyMap<string, RegExp> = new Map([
  ["tile", /^\s*(?:=|[A-Za-z_][A-Za-z0-9_-]*\s*=)/],
  ["type", /^\s*[(=]/],
]);

function statesHeader(layer: string, body: string): boolean {
  return HEADER_START.get(layer)?.test(body) ?? false;
}

export function withHeader(layer: string, body: string, header: () => string): string {
  return !HEADER_START.has(layer) || statesHeader(layer, body) ? body : `${header()}${body}`;
}

function headerSpan(
  store: Store,
  entry: DefEntry,
  verb: string,
): { text: string; from: number; to: number } {
  const qname = `${entry.layer}.${entry.name}`;
  const text = definitionText(store, entry);
  const rhs = rightHandSide(entry.def);
  const lines = text.split("\n");
  // Positions relative to the definition's text: its first line is line 1.
  const offset = (line: number, col: number): number =>
    lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
  const tokens = lex(text);
  const [keyword, name, first] = tokens;
  const inText = rhs === undefined ? undefined : posInText(entry, rhs);
  const at = tokens.findIndex((t) => t.pos.line === inText?.line && t.pos.col === inText.col);
  const eq = tokens[at - 1];
  if (
    inText === undefined ||
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
  return {
    text,
    from: offset(first.pos.line, first.pos.col),
    to: offset(inText.line, inText.col),
  };
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
export function headerOf(store: Store, entry: DefEntry, verb: string): string {
  const { text, from, to } = headerSpan(store, entry, verb);
  return text.slice(from, to);
}

export { definitionText };

/** `store.source` with `text` in place of the definition's, from its first token to its last. */
export function withText(store: Store, entry: DefEntry, text: string): string {
  const { source } = store;
  const { start, end } = entry.range;
  return source.slice(0, start) + joinLines(source, [text]) + source.slice(end);
}

/** The definition that ends on `entry`'s first line, or starts on its last, if any. */
function lineMate(store: Store, entry: DefEntry): "before" | "after" | undefined {
  const at = store.defs.indexOf(entry);
  if (store.defs[at - 1]?.range.endLine === entry.range.startLine) return "before";
  if (store.defs[at + 1]?.range.startLine === entry.range.endLine) return "after";
  return undefined;
}

/** A definition `withoutDefinitions` cut, as `store` held it, and the text the cut took. */
export type Cut = { entry: DefEntry; text: string };

/**
 * `store.source` without the definitions `qnames` name, each cut where it stands once those
 * before it are, and each cut in the order of `qnames`.
 */
export function withoutDefinitions(
  store: Store,
  qnames: readonly string[],
): { source: string; cuts: Cut[] } {
  let next = store.source;
  const cuts: Cut[] = [];
  for (const q of qnames) {
    const entry = store.byQName.get(q);
    const now = loadSource(next);
    const here = now.byQName.get(q);
    if (entry === undefined || here === undefined) throw new Error(`Definition "${q}" not found`);
    const cut = withoutDefinition(now, here);
    next = cut.source;
    cuts.push({ entry, text: cut.text });
  }
  return { source: next, cuts };
}

/**
 * `store.source` without the definition, and what it took: the lines it stands on, comments on
 * them included, when no other definition shares them; else its text, and with it the spaces
 * between it and the definition it shares a line with, the one before it when both sides do.
 */
function withoutDefinition(store: Store, entry: DefEntry): { source: string; text: string } {
  const { source, defs } = store;
  const at = defs.indexOf(entry);
  const { start, end, startLine, endLine } = entry.range;
  const text = definitionText(store, entry);
  switch (lineMate(store, entry)) {
    case "before":
      return { source: source.slice(0, defs[at - 1]!.range.end) + source.slice(end), text };
    case "after":
      return { source: source.slice(0, start) + source.slice(defs[at + 1]!.range.start), text };
    default:
      return {
        source: spliceLines(source, startLine, endLine, []),
        text: store.lines.slice(startLine - 1, endLine).join("\n"),
      };
  }
}

/** Where a `remove` records a definition stood, so that its revert can put it back there. */
export function removedPlace(
  store: Store,
  entry: DefEntry,
): { after?: string; gap: number; last?: true } {
  const before = store.defs[store.defs.indexOf(entry) - 1];
  const { startLine, endLine } = entry.range;
  return {
    ...(before === undefined ? {} : { after: `${before.layer}.${before.name}` }),
    // None when it starts on the line the one before it ends on: it goes back on the next line.
    gap: Math.max(0, startLine - (before?.range.endLine ?? 0) - 1),
    // A file that ends in a line break splits into one more line, an empty one.
    ...(endLine === store.lines.length ? { last: true } : {}),
  };
}

export function bodyOf(store: Store, entry: DefEntry, verb: string): string {
  if (HEADER_START.has(entry.layer)) {
    const { text, from } = headerSpan(store, entry, verb);
    return text.slice(from).trimEnd();
  }
  return extractBody(entry.layer, entry.name, definitionText(store, entry));
}

export function headerItems(def: Def | undefined): string[] {
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

function extractBody(layer: string, name: string, text: string): string {
  const n = escapeRegExp(name);
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

/** Every place `entry`'s name is spelled: the token after its keyword, and each reference. */
export function nameSites(
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
  return { own: entry.namePos, refs, unpositioned };
}

export function respell(
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

export function splitQname(qname: string): [string, string] {
  const dot = qname.indexOf(".");
  if (dot < 0) throw new Error(`qname must be "<layer>.<name>": ${qname}`);
  return [qname.slice(0, dot), qname.slice(dot + 1)];
}

/** What follows the name: nothing before `(` (`fn f(x: Int)`, `type Box(T)`), a space otherwise. */
const afterName = (rest: string): string => `${rest.startsWith("(") ? "" : " "}${rest}`;

export function assemble(layer: string, name: string, body: string): string {
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
