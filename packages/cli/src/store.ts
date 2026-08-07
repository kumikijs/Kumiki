// Definition store: parse a .kumiki file, record source ranges, and answer
// list / view / refs queries. Read-only on disk; mutations go through a
// separate path that rewrites the file and appends to the op-log.

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

const LAYER_OF: Record<string, string> = {
  TypeDef: "type",
  SlotDef: "slot",
  EffectDef: "effect",
  ReducerDef: "reducer",
  TileDef: "tile",
  FnDef: "fn",
  AppDef: "app",
  ThemeDef: "theme",
  MotionDef: "motion",
};

export function load(path: string): Store {
  const source = readFileSync(path, "utf8");
  const lines = source.split(/\r?\n/);
  const tokens = lex(source);
  const program = parse(tokens);
  const defs = buildEntries(program, lines, tokens);
  const byQName = new Map<string, DefEntry>();
  for (const e of defs) byQName.set(`${e.layer}.${e.name}`, e);
  return { source, lines, program, defs, byQName };
}

function buildEntries(program: Program, lines: string[], tokens: Token[]): DefEntry[] {
  const out: DefEntry[] = [];
  for (let i = 0; i < program.defs.length; i++) {
    const d = program.defs[i]!;
    const layer = LAYER_OF[d.kind] ?? "?";
    const name = "name" in d ? d.name : "_";
    const start = (d as { pos?: { line: number } }).pos?.line ?? 1;
    // End line: just before the next def's start (or last line of file).
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

export function viewWithDeps(store: Store, qname: string): string {
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

/**
 * Every reference each definition makes, resolved against the program's
 * definition index. Computed once per `Store` because `refs`, `view --with-deps`
 * and `remove --cascade` all ask about the same relation, and they used to
 * disagree: one stripped strings before matching and the other did not.
 */
function refTable(store: Store): Map<string, Reference[]> {
  if (store.refs) return store.refs;
  const index = buildDefIndex(store.program);
  const table = new Map<string, Reference[]>();
  for (const e of store.defs) table.set(`${e.layer}.${e.name}`, referencesIn(e.def, index));
  store.refs = table;
  return table;
}

/**
 * The qnames the definition at `qname` references. A definition is never its
 * own dependency: a self-recursive tile or fn names itself, and reporting that
 * turned `view --with-deps` into a cycle and `refs` into a lie.
 */
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

/**
 * Where `targetQname` is referenced, one entry per definition+line. Layer-aware:
 * a `slot label` and a record field called `label` are different things, and so
 * are a `type Filter` and a `slot filter`.
 */
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
      const key = `${from}:${r.pos.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ qname: from, layer: e.layer, name: e.name, line: r.pos.line });
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
