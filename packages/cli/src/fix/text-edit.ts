import type { AppDef, Pos, Program, Token } from "@kumikijs/compiler";
import { LexError, lex, ParseError, parse, servesNotFound } from "@kumikijs/compiler";
import { lineSpan, type Store } from "../store.ts";
import { escapeRegExp } from "../text.ts";

const OPENING = new Set(["(", "[", "{"]);
const CLOSING = new Set([")", "]", "}"]);

/** The plain name at `pos`, or null when it is followed by `.`, `(` or `[`. */
export function identifierAt(store: Store, pos: Pos): string | null {
  const line = store.lines[pos.line - 1];
  if (line === undefined) return null;
  const rest = line.slice(pos.col - 1);
  const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(rest);
  if (!m) return null;
  const after = rest.slice(m[0].length);
  if (/^[.([]/.test(after)) return null;
  return m[0];
}

export function replaceAt(text: string, pos: Pos, missing: string, replacement: string): string {
  const span = lineSpan(text, pos.line);
  if (!span) return text;
  const at = span.start + pos.col - 1;
  if (at + missing.length > span.end) return text;
  if (text.slice(at, at + missing.length) !== missing) return text;
  return text.slice(0, at) + replacement + text.slice(at + missing.length);
}

/** Replaces the first whole-word `missing` on `pos`'s line. */
export function replaceOnLine(
  text: string,
  pos: Pos,
  missing: string,
  replacement: string,
): string {
  const span = lineSpan(text, pos.line);
  if (!span) return text;
  const line = text.slice(span.start, span.end);
  const re = new RegExp(`\\b${escapeRegExp(missing)}\\b`);
  const at = line.search(re);
  if (at === -1) return text;
  return (
    text.slice(0, span.start + at) + replacement + text.slice(span.start + at + missing.length)
  );
}

/** Drops the `name=value` argument at `pos` together with the comma that separates it. */
export function removeNamedArg(text: string, pos: Pos, name: string): string {
  const offset = (p: Pos): number | null => {
    const span = lineSpan(text, p.line);
    return span ? span.start + p.col - 1 : null;
  };
  let tokens: Token[];
  try {
    tokens = lex(text);
  } catch {
    return text;
  }
  const at = tokens.findIndex((t) => t.pos.line === pos.line && t.pos.col === pos.col);
  const nameTok = tokens[at];
  const eq = tokens[at + 1];
  if (nameTok?.kind !== "ident" && nameTok?.kind !== "kw") return text;
  if (nameTok.value !== name || eq?.kind !== "op" || eq.value !== "=") return text;
  let depth = 0;
  let stop: Token | undefined;
  for (const t of tokens.slice(at + 2)) {
    if (t.kind !== "op") continue;
    if (OPENING.has(t.value)) depth += 1;
    else if (CLOSING.has(t.value) && depth > 0) depth -= 1;
    else if (CLOSING.has(t.value) || (t.value === "," && depth === 0)) {
      stop = t;
      break;
    }
  }
  const start = offset(pos);
  const stopAt = stop && offset(stop.pos);
  if (start === null || !stop || stopAt == null) return text;
  if (stop.kind === "op" && stop.value === ",") {
    // `name=…, next` → `next`, keeping whatever precedes the argument.
    const gap = /^[ \t]*/.exec(text.slice(stopAt + 1))?.[0].length ?? 0;
    return text.slice(0, start) + text.slice(stopAt + 1 + gap);
  }
  const comma = tokens[at - 1];
  const commaAt = comma && offset(comma.pos);
  if (comma?.kind !== "op" || comma.value !== "," || commaAt == null) return text;
  const valueEnd = start + text.slice(start, stopAt).trimEnd().length;
  return text.slice(0, commaAt) + text.slice(valueEnd);
}

/** Appends `entry` to the app's `caps` or `routes` list; null when it cannot or need not. */
function appendToAppClause(
  text: string,
  field: "caps" | "routes",
  entry: string,
  present: (app: AppDef) => boolean,
): string | null {
  let tokens: Token[];
  let program: Program;
  try {
    tokens = lex(text);
    program = parse(tokens);
  } catch (e) {
    if (e instanceof LexError || e instanceof ParseError) return null;
    throw e;
  }
  const index = program.defs.findIndex((d) => d.kind === "AppDef");
  const app = program.defs[index];
  if (app?.kind !== "AppDef" || present(app)) return null;
  const tokenAt = (p: Pos): number =>
    tokens.findIndex((t) => t.pos.line === p.line && t.pos.col === p.col);
  const next = program.defs[index + 1];
  const from = tokenAt(app.pos);
  const to = next ? tokenAt(next.pos) : tokens.length - 1;
  if (from === -1 || to === -1) return null;
  let open = -1;
  let depth = 0;
  for (let i = from; i < to; i++) {
    const t = tokens[i]!;
    if (t.kind === "op" && OPENING.has(t.value)) depth += 1;
    else if (t.kind === "op" && CLOSING.has(t.value)) depth -= 1;
    else if (depth === 0 && t.kind === "ident" && t.value === field) {
      const eq = tokens[i + 1];
      if (eq?.kind === "op" && eq.value === "=") open = i + 2;
    }
  }
  if (open === -1) return null;
  // The bracket that closes it. The text parsed, so there is one.
  let close = open + 1;
  for (depth = 0; close < tokens.length; close++) {
    const t = tokens[close]!;
    if (t.kind !== "op") continue;
    if (OPENING.has(t.value)) depth += 1;
    else if (CLOSING.has(t.value)) {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  const last = tokens[close - 1]!;
  const line = lineSpan(text, last.pos.line);
  if (last.kind === "eof" || !line) return null;
  const start = line.start + last.pos.col - 1;
  const empty = close - 1 === open;
  const at = start + (empty ? 1 : tokenLength(text, last, start));
  return `${text.slice(0, at)}${empty ? entry : `, ${entry}`}${text.slice(at)}`;
}

export function appendAppCap(text: string, cap: string): string | null {
  return appendToAppClause(text, "caps", cap, (app) => app.caps.includes(cap));
}

export function append404Route(text: string): string | null {
  return appendToAppClause(text, "routes", `"/404" -> NotFound`, (app) =>
    servesNotFound(app.routes),
  );
}

/** The source length of one token: a string's is read back from its quotes. */
export function tokenLength(
  source: string,
  t: Exclude<Token, { kind: "eof" }>,
  start: number,
): number {
  if (t.kind === "num") return t.raw.length;
  if (t.kind !== "str") return t.value.length;
  let i = start + 1;
  while (i < source.length && source[i] !== '"') i += source[i] === "\\" ? 2 : 1;
  return i + 1 - start;
}
