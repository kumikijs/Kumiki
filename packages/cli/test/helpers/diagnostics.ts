import { check, type KumikiError, lex, parse } from "@kumikijs/compiler";
import { formatDiagnostic } from "../../src/diagnostic.ts";

/** Each error (not warning) `check` reports on `source`. */
export const errorDiagnosticsOf = (source: string): KumikiError[] =>
  check(parse(lex(source))).filter((e) => e.severity !== "warning");

/** Each error (not warning) `check` reports on `source`, as `"<code> <message>"`. */
export const errorsOf = (source: string): string[] =>
  errorDiagnosticsOf(source).map((e) => `${e.code} ${e.message}`);

/** Each warning `check` reports on `source`, one line each as `kumiki check` prints it. */
export const warningLinesOf = (source: string): string =>
  check(parse(lex(source)))
    .filter((e) => e.severity === "warning")
    .map((e) => `${formatDiagnostic(e)}\n`)
    .join("");
