import { check, type KumikiError, lex, parse } from "@kumikijs/compiler";

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

/** Each diagnostic as `"<code> <message>"`. */
export const summariesOf = (src: string): string[] =>
  checkSource(src).map((e) => `${e.code} ${e.message}`);

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
