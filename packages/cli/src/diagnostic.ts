import type { KumikiError } from "@kumikijs/compiler";

export function formatDiagnostic(d: KumikiError): string {
  return `${d.code} ${d.kind} at ${d.pos.line}:${d.pos.col}: ${d.message}`;
}
