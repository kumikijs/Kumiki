import { type KumikiError, severityOf } from "@kumikijs/compiler";

/**
 * One diagnostic as a line of text: severity, code, kind, `line:col`, message —
 * `error E0103 undef-ref at 4:30: …`, `warning W0212 … at 2:17: …`.
 *
 * The severity leads, read through `severityOf`, so a reader tells an advisory
 * diagnostic from a failure by the line itself rather than by the letter its
 * code starts with. `check`, `build`, the verbs that compile before they run
 * (`test`, `smoke`, `run`), `fix`'s lists of errors and warnings, and the MCP
 * `kumiki_fix` dry run all print a diagnostic through this, so it reads the
 * same whichever of them found it.
 */
export function formatDiagnostic(d: KumikiError): string {
  return `${severityOf(d)} ${d.code} ${d.kind} at ${d.pos.line}:${d.pos.col}: ${d.message}`;
}

/**
 * The diagnostic for source that does not lex or parse. The lexer and parser
 * throw rather than report, so a tool whose output is a list of diagnostics —
 * `fix`'s regression gate, the MCP tools' JSON — puts this `E0000` in the list
 * instead, and an empty list keeps meaning a clean file. `message` is the
 * thrown error's own and `pos` where it stopped, `0:0` when it carries none.
 */
export function parseFailure(e: unknown): KumikiError {
  const pos = (e as { pos?: { line: number; col: number } }).pos;
  return {
    code: "E0000",
    kind: "parse-error",
    message: e instanceof Error ? e.message : String(e),
    pos: { line: pos?.line ?? 0, col: pos?.col ?? 0 },
  };
}
