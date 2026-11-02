import { check, lex, parse } from "@kumikijs/compiler";

/** Each error (not warning) `check` reports on `source`, as `"<code> <message>"`. */
export const errorsOf = (source: string): string[] =>
  check(parse(lex(source)))
    .filter((e) => e.severity !== "warning")
    .map((e) => `${e.code} ${e.message}`);
