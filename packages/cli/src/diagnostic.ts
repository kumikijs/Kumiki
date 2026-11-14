import { type KumikiError, severityOf } from "@kumikijs/compiler";

export function formatDiagnostic(d: KumikiError): string {
  return `${severityOf(d)} ${d.code} ${d.kind} at ${d.pos.line}:${d.pos.col}: ${d.message}`;
}
