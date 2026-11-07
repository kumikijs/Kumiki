import { readFileSync } from "node:fs";
import type { Def, Program, Token } from "@kumikijs/compiler";
import {
  buildDefIndex,
  lex,
  type Pos,
  parse,
  type Reference,
  referencesIn,
} from "@kumikijs/compiler";

/** Where a definition's text is: from its first token to its last, whatever the line layout. */
export type DefRange = {
  /** 1-based line of its first token. */
  startLine: number;
  /** 1-based line its last token ends on. */
  endLine: number;
  /** Offset in the source of its first token. */
  start: number;
  /** Offset in the source just past its last token. */
  end: number;
};

export type DefEntry = {
  layer: string;
  name: string;
  def: Def;
  range: DefRange;
  /** Where its own name is spelled: the token after its keyword. */
  namePos: Pos | undefined;
};

export type Store = {
  source: string;
  lines: string[];
  program: Program;
  defs: DefEntry[];
  byQName: Map<string, DefEntry>;
  /** Lazily built by `refTable`; qname -> the references that definition makes. */
  refs?: Map<string, Reference[]>;
};

const LAYER_OF = {
  TypeDef: "type",
  SlotDef: "slot",
  EffectDef: "effect",
  ReducerDef: "reducer",
  TileDef: "tile",
  FnDef: "fn",
  AppDef: "app",
  ThemeDef: "theme",
  MotionDef: "motion",
  TestDef: "test",
} as const satisfies Record<Def["kind"], string>;

export const LAYERS = Object.values(LAYER_OF);

export function load(path: string): Store {
  return loadSource(readFileSync(path, "utf8"));
}

// A lone `\r` is whitespace inside a line (language.md), not a line break.
const LINE_BREAK = /\r?\n/;

/** `load` for source text that is not (or not yet) on disk. */
export function loadSource(source: string): Store {
  const lines = source.split(LINE_BREAK);
  const tokens = lex(source);
  const program = parse(tokens);
  const defs = buildEntries(program, source, tokens);
  const byQName = new Map<string, DefEntry>();
  for (const e of defs) byQName.set(`${e.layer}.${e.name}`, e);
  return { source, lines, program, defs, byQName };
}

/**
 * Edits go through these offsets rather than a split and a `\n` join, which
 * would rewrite every CRLF in the file to LF.
 */
export function lineSpan(text: string, line: number): { start: number; end: number } | null {
  if (line < 1) return null;
  let start = 0;
  for (let n = 1; n < line; n++) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) return null;
    start = nl + 1;
  }
  const nl = text.indexOf("\n", start);
  if (nl === -1) return { start, end: text.length };
  return { start, end: text[nl - 1] === "\r" ? nl - 1 : nl };
}

function lineBreakOf(text: string): string {
  return LINE_BREAK.exec(text)?.[0] ?? "\n";
}

/** A body or a patch carries whichever line break it was written with; the file keeps one. */
export function joinLines(source: string, lines: readonly string[]): string {
  return lines.join("\n").split(LINE_BREAK).join(lineBreakOf(source));
}

/** The empty range `to === from - 1` inserts before line `from`. */
export function spliceLines(
  text: string,
  from: number,
  to: number,
  lines: readonly string[],
): string {
  const first = lineSpan(text, from);
  const last = lineSpan(text, to);
  if (first === null || to < from - 1 || (to > 0 && last === null)) {
    throw new Error(`lines ${from} to ${to} are not lines of the text`);
  }
  if (lines.length > 0) {
    // With `to` 0 they go before line 1, where no line's break follows them,
    // so the file's does.
    const rest = last === null ? lineBreakOf(text) + text : text.slice(last.end);
    return text.slice(0, first.start) + joinLines(text, lines) + rest;
  }
  const next = lineSpan(text, to + 1);
  if (next !== null) return text.slice(0, first.start) + text.slice(next.start);
  const prev = lineSpan(text, from - 1);
  return prev === null ? "" : text.slice(0, prev.end);
}

function buildEntries(program: Program, source: string, tokens: Token[]): DefEntry[] {
  const lineStarts = [0];
  for (let i = source.indexOf("\n"); i !== -1; i = source.indexOf("\n", i + 1)) {
    lineStarts.push(i + 1);
  }
  const offsetOf = (p: Pos): number => lineStarts[p.line - 1]! + p.col - 1;
  // A definition's first token is its keyword, and its tokens run up to the next one's.
  const firsts: number[] = [];
  let at = 0;
  for (const d of program.defs) {
    while (at < tokens.length && !samePos(tokens[at]!.pos, d.pos)) at++;
    firsts.push(at);
  }
  return program.defs.map((d, i) => {
    const first = tokens[firsts[i]!]!;
    const last = tokens[(firsts[i + 1] ?? tokens.length - 1) - 1]!;
    const lastAt = offsetOf(last.pos);
    const end = lastAt + tokenLength(source, lastAt, last);
    const own = "name" in d ? d.name : "_";
    const name = tokens[firsts[i]! + 1];
    return {
      layer: LAYER_OF[d.kind],
      name: own,
      def: d,
      range: {
        startLine: first.pos.line,
        endLine: last.pos.line + (source.slice(lastAt, end).match(/\n/g)?.length ?? 0),
        start: offsetOf(first.pos),
        end,
      },
      namePos: name?.kind === "ident" && name.value === own ? name.pos : undefined,
    };
  });
}

function samePos(a: Pos, b: Pos): boolean {
  return a.line === b.line && a.col === b.col;
}

/** How many characters of `source`, from `at`, the token `t` there takes. */
function tokenLength(source: string, at: number, t: Token): number {
  switch (t.kind) {
    case "num":
      return t.raw.length;
    case "str": {
      // A string's value has its escapes decoded, so its length is read off the source.
      let i = at + 1;
      while (i < source.length && source[i] !== '"') i += source[i] === "\\" ? 2 : 1;
      return i + 1 - at;
    }
    case "eof":
      return 0;
    default:
      return t.value.length;
  }
}

/** The definition's text, from its first token to its last, with `\n` line breaks. */
export function definitionText(store: Store, entry: DefEntry): string {
  return store.source.slice(entry.range.start, entry.range.end).split(LINE_BREAK).join("\n");
}

/** Where `pos`, a position in the file, is in the definition's text, which starts at 1:1. */
export function posInText(entry: DefEntry, pos: Pos): Pos {
  const line = pos.line - entry.range.startLine + 1;
  return { line, col: line === 1 ? pos.col - entry.def.pos.col + 1 : pos.col };
}

/** Where `pos`, a position in the definition's text, is in the file. */
export function posInFile(entry: DefEntry, pos: Pos): Pos {
  const line = pos.line + entry.range.startLine - 1;
  return { line, col: pos.line === 1 ? pos.col + entry.def.pos.col - 1 : pos.col };
}

export function viewDef(store: Store, qname: string): string | null {
  const e = store.byQName.get(qname);
  return e ? definitionText(store, e) : null;
}

export function viewWithDeps(store: Store, qname: string): string | null {
  if (!store.byQName.has(qname)) return null;
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (q: string): void => {
    if (seen.has(q)) return;
    seen.add(q);
    const refs = directDeps(store, q);
    for (const r of refs) visit(r);
    order.push(q);
  };
  visit(qname);
  return order
    .map((q) => viewDef(store, q))
    .filter((s) => s !== null)
    .join("\n\n");
}

function refTable(store: Store): Map<string, Reference[]> {
  if (store.refs) return store.refs;
  const index = buildDefIndex(store.program);
  const table = new Map<string, Reference[]>();
  for (const e of store.defs) table.set(`${e.layer}.${e.name}`, referencesIn(e.def, index));
  store.refs = table;
  return table;
}

export function directDeps(store: Store, qname: string): string[] {
  const refs = refTable(store).get(qname);
  if (!refs) return [];
  const out = new Set<string>();
  for (const r of refs) {
    const q = `${r.layer}.${r.name}`;
    if (q !== qname) out.add(q);
  }
  return Array.from(out).sort();
}

export type RefSite = { qname: string; layer: string; name: string; line: number };

export function findReferences(store: Store, targetQname: string): RefSite[] {
  const target = store.byQName.get(targetQname);
  if (!target) return [];
  const out: RefSite[] = [];
  const seen = new Set<string>();
  for (const e of store.defs) {
    if (e === target) continue;
    const from = `${e.layer}.${e.name}`;
    for (const r of refTable(store).get(from) ?? []) {
      if (`${r.layer}.${r.name}` !== targetQname) continue;
      const key = `${from}:${r.pos?.line ?? 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        qname: from,
        layer: e.layer,
        name: e.name,
        line: r.pos?.line ?? e.range.startLine,
      });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Every reference site inside `qname`'s own body, for a precise rewrite. */
export function referenceSites(store: Store, qname: string): Reference[] {
  return refTable(store).get(qname) ?? [];
}

export function listDefs(store: Store, layer?: string): DefEntry[] {
  if (layer) return store.defs.filter((e) => e.layer === layer);
  return store.defs;
}
