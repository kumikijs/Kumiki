import type { KumikiError } from "@kumikijs/compiler";

/**
 * One diagnostic as every CLI verb prints it: code, kind, `line:col`, message.
 * `check`, `build`, and the verbs that compile before they run (`test`,
 * `smoke`, `run`) all go through this, so a diagnostic reads the same whichever
 * verb found it.
 */
export function formatDiagnostic(d: KumikiError): string {
  return `${d.code} ${d.kind} at ${d.pos.line}:${d.pos.col}: ${d.message}`;
}
