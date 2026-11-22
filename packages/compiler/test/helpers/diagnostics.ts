import { check, compile, type KumikiError, lex, parse } from "@kumikijs/compiler";

export type CheckOptions = Parameters<typeof check>[1];

export type Located = { code: string; message: string; line: number; col: number };

/** A diagnostic with the source text from its position to the end of that line. */
export type Pointed = { code: string; message: string; text: string };

export const checkSource = (src: string, opts?: CheckOptions): KumikiError[] =>
  check(parse(lex(src)), opts);

export const codesOf = (src: string, opts?: CheckOptions): string[] =>
  checkSource(src, opts).map((e) => e.code);

export const errorsOf = (src: string): KumikiError[] =>
  checkSource(src).filter((e) => e.severity !== "warning");

export const errorCodesOf = (src: string): string[] => errorsOf(src).map((e) => e.code);

/** Each diagnostic as `"<code> <line>:<col> <message>"`. */
export const locatedSummariesOf = (src: string): string[] =>
  checkSource(src).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

/** E0231's message for a program's own definition of `name`, which already means `meaning`. */
export const reservedTypeNameMessage = (name: string, meaning = "the standard library's"): string =>
  `Type "${name}" collides with ${meaning} ${name}; uses of it never see this type`;

/** E0234's message for a program's own `effect` under the standard effect `name`. */
export const reservedEffectNameMessage = (name: string): string =>
  `Effect "${name}" collides with the built-in effect ${name}; emits of it never run this effect`;

/** E0240's message, for a record field written under the name the runtime marks a variant with. */
export const reservedFieldNameMessage =
  'Record field "_tag" is reserved: the runtime marks a variant with a field of that name, so a record that has one is read as a variant. Name the field something else — "tag"';

/** E0235's message, for a `null` written where an expression goes. */
export const nullValueMessage =
  "`null` is not a value — Kumiki has no null. Where a value may be absent, declare Option(T) and write None for no value, Some(x) for one";

/** E0236's message, for a tile as `builtin`'s content, where `shown` is that builtin showing a value. */
export const tileAsContentMessage = (builtin: string, shown: string): string =>
  `A tile is not a value: ${builtin} shows a value as its content, so this tile is never ` +
  `rendered. Write the tile as a child of a container — \`column(when(c, …))\` — or show a ` +
  `value — \`${shown}\``;

/** E0201's message, for a tile written as `tile`'s named argument `name`. */
export const tileAsPropMessage = (tile: string, name: string): string =>
  `Named argument "${name}" on tile "${tile}" is a prop, and a prop's value cannot be a tile — ` +
  `nothing renders it. Write the tile as a positional child of a container — ` +
  `\`column(when(c, …))\` — or pass a value — \`${tile}(${name}=…)\``;

/** The message of the one diagnostic `src` reports under `code`; none, or more than one, throws. */
export function soleMessageOf(code: string, src: string, opts?: CheckOptions): string {
  const found = checkSource(src, opts).filter((e) => e.code === code);
  const [only] = found;
  if (only === undefined || found.length > 1) {
    const messages = found.map((e) => e.message).join(" | ");
    throw new Error(`expected one ${code}, got ${found.length}: ${messages}`);
  }
  return only.message;
}

/** Each diagnostic as `"<code> <message>"`. */
export const summariesOf = (src: string): string[] =>
  checkSource(src).map((e) => `${e.code} ${e.message}`);

/** What `build` refuses `src` with, each as `"<code> <message>"`; empty when it builds. */
export function builtSummariesOf(src: string): string[] {
  const r = compile(src, { runtimeSpecifier: "./runtime.js" });
  return r.kind === "fail" ? r.errors.map((e) => `${e.code} ${e.message}`) : [];
}

export const messagesOf = (src: string, { warnings = true } = {}): string[] =>
  (warnings ? checkSource(src) : errorsOf(src)).map((e) => e.message).sort();

export function locatedOf(src: string, { warnings = true } = {}): Located[] {
  return (warnings ? checkSource(src) : errorsOf(src)).map((e) => ({
    code: e.code,
    message: e.message,
    line: e.pos.line,
    col: e.pos.col,
  }));
}

/** The text at a 1-based position, to the end of its line, so a position is read rather than counted. */
export function textAt(source: string, at: { line: number; col: number }): string {
  return (source.split("\n")[at.line - 1] ?? "").slice(at.col - 1);
}

/** Where `needle` first occurs, as the 1-based line/col diagnostics use. */
export function posOf(source: string, needle: string): { line: number; col: number } {
  const idx = source.indexOf(needle);
  if (idx < 0) throw new Error(`"${needle}" does not occur in the source`);
  const before = source.slice(0, idx).split("\n");
  return { line: before.length, col: (before[before.length - 1] ?? "").length + 1 };
}

/** The errors of `src`, each pointing at the source text it was reported at. */
export const pointedErrorsOf = (src: string): Pointed[] =>
  errorsOf(src).map((e) => ({ code: e.code, message: e.message, text: textAt(src, e.pos) }));

/** As {@link pointedErrorsOf}, warnings included. */
export const pointedDiagnosticsOf = (src: string): Pointed[] =>
  checkSource(src).map((e) => ({ code: e.code, message: e.message, text: textAt(src, e.pos) }));

/** E0227's message, for a value match on `type` that has no arm for `values`. */
export const nonExhaustiveMessage = (type: string, values: string): string =>
  `This match on "${type}" has no arm for ${values}, and a match used as a value has to evaluate ` +
  "to one of its arms. Add the missing arms, or end with `_ -> …`";
