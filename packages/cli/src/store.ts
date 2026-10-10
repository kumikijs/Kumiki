import { readFileSync } from "node:fs";
import type { Def, Program, Token } from "@kumikijs/compiler";
import { buildDefIndex, lex, parse, type Reference, referencesIn } from "@kumikijs/compiler";

export type DefRange = {
  /** 1-based start line in the source file. */
  startLine: number;
  /** 1-based end line, inclusive. */
  endLine: number;
};

export type DefEntry = {
  layer: string;
  name: string;
  def: Def;
  range: DefRange;
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
  const defs = buildEntries(program, lines, tokens);
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

/**
 * The empty range `to === from - 1` inserts before line `from`: the store gives a
 * definition that range when the next one starts on its line.
 */
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

function buildEntries(program: Program, lines: string[], tokens: Token[]): DefEntry[] {
  const out: DefEntry[] = [];
  for (let i = 0; i < program.defs.length; i++) {
    const d = program.defs[i]!;
    const layer = LAYER_OF[d.kind];
    const name = "name" in d ? d.name : "_";
    const start = (d as { pos?: { line: number } }).pos?.line ?? 1;
    const next = program.defs[i + 1];
    const nextStart = next && (next as { pos?: { line: number } }).pos?.line;
    const endLine = nextStart ? nextStart - 1 : lines.length;
    out.push({ layer, name, def: d, range: { startLine: start, endLine } });
  }
  // Trim trailing blank/comment lines from each range.
  for (const e of out) {
    let end = e.range.endLine;
    while (end > e.range.startLine) {
      const line = lines[end - 1] ?? "";
      if (line.trim() === "" || line.trim().startsWith("#")) end--;
      else break;
    }
    e.range.endLine = end;
  }
  void tokens;
  return out;
}

export function viewDef(store: Store, qname: string): string | null {
  const e = store.byQName.get(qname);
  if (!e) return null;
  return store.lines.slice(e.range.startLine - 1, e.range.endLine).join("\n");
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
