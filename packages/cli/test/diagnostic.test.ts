import type { KumikiError } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { formatDiagnostic } from "../src/diagnostic.ts";

const diagnostic = (d: Partial<KumikiError>): KumikiError => ({
  code: "E0103",
  kind: "undef-ref",
  message: 'Reference to undefined name "totl"',
  pos: { line: 4, col: 30 },
  ...d,
});

describe("formatDiagnostic", () => {
  it.each<[string, Partial<KumikiError>, string]>([
    [
      "an error",
      { severity: "error" },
      'error E0103 undef-ref at 4:30: Reference to undefined name "totl"',
    ],
    [
      "a diagnostic with no severity, as an error",
      {},
      'error E0103 undef-ref at 4:30: Reference to undefined name "totl"',
    ],
    [
      "a warning",
      {
        code: "W0212",
        kind: "ui-event-tile-mismatch",
        message: "The handler is silently dropped.",
        pos: { line: 2, col: 17 },
        severity: "warning",
      },
      "warning W0212 ui-event-tile-mismatch at 2:17: The handler is silently dropped.",
    ],
  ])("prints %s as severity, code, kind, position and message", (_, d, line) => {
    expect(formatDiagnostic(diagnostic(d))).toBe(line);
  });

  it.each<[Partial<KumikiError>, RegExp]>([
    [{ code: "E9999", severity: "warning" }, /^warning E9999 /],
    [{ code: "W9999" }, /^error W9999 /],
  ])("takes the severity from the field, not from the code's first letter (%o)", (d, line) => {
    expect(formatDiagnostic(diagnostic(d))).toMatch(line);
  });
});
