import { type Def, LexError, lex, type Pos, type Token } from "@kumikijs/compiler";
import { type DefEntry, referenceSites, type Store, viewDef } from "../store.ts";
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
export function headerOf(store: Store, entry: DefEntry, verb: string): string {
  const { text, from, to } = headerSpan(store, entry, verb);
  return text.slice(from, to);
}

export function bodyOf(store: Store, entry: DefEntry, verb: string): string {
  if (HEADER_START.has(entry.layer)) {
    const { text, from } = headerSpan(store, entry, verb);
    return text.slice(from).trimEnd();
  }
  return extractBody(entry.layer, entry.name, viewDef(store, `${entry.layer}.${entry.name}`) ?? "");
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

/** Every place `entry`'s name is spelled: on its own definition line and in each reference. */
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
  return { own: defNamePos(store, entry, entry.name), refs, unpositioned };
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

export function defNamePos(store: Store, entry: DefEntry, name: string): Pos | undefined {
  const line = store.lines[entry.range.startLine - 1] ?? "";
  const keywordCol = (entry.def as { pos?: Pos }).pos?.col ?? 1;
  const from = keywordCol - 1 + entry.layer.length;
  const at = line.indexOf(name, from);
  return at < 0 ? undefined : { line: entry.range.startLine, col: at + 1 };
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
