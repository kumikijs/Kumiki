import { type KumikiError, severityOf } from "@kumikijs/compiler";
import { messageOf } from "./text.ts";

export function formatDiagnostic(d: KumikiError): string {
  return `${severityOf(d)} ${d.code} ${d.kind} at ${d.pos.line}:${d.pos.col}: ${d.message}`;
}

// The lexer and parser throw rather than report, so a tool that answers with a
// diagnostic list puts this in it and an empty list keeps meaning a clean file.
export function parseFailure(e: unknown): KumikiError {
  const pos = (e as { pos?: { line: number; col: number } }).pos;
  return {
    code: "E0000",
    kind: "parse-error",
    message: messageOf(e),
    pos: { line: pos?.line ?? 0, col: pos?.col ?? 0 },
  };
}
