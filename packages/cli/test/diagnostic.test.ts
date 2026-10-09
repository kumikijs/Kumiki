// `formatDiagnostic` is the one place a diagnostic becomes a line of text, for
// every verb that prints one. The line leads with the diagnostic's severity,
// read from its `severity` field: the `E` / `W` on a code is a naming
// convention, and a reader of the line should not need to know it.

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
  it("leads with the severity, then code, kind, position and message", () => {
    expect(formatDiagnostic(diagnostic({ severity: "error" }))).toBe(
      'error E0103 undef-ref at 4:30: Reference to undefined name "totl"',
    );
    expect(
      formatDiagnostic(
        diagnostic({
          code: "W0212",
          kind: "ui-event-tile-mismatch",
          message: "The handler is silently dropped.",
          pos: { line: 2, col: 17 },
          severity: "warning",
        }),
      ),
    ).toBe("warning W0212 ui-event-tile-mismatch at 2:17: The handler is silently dropped.");
  });

  it("reads an omitted severity as error", () => {
    expect(formatDiagnostic(diagnostic({}))).toBe(
      'error E0103 undef-ref at 4:30: Reference to undefined name "totl"',
    );
  });

  it("takes the severity from the field, not from the code's first letter", () => {
    // Codes that contradict the convention, so only the field can produce
    // these words.
    expect(formatDiagnostic(diagnostic({ code: "E9999", severity: "warning" }))).toMatch(
      /^warning E9999 /,
    );
    expect(formatDiagnostic(diagnostic({ code: "W9999" }))).toMatch(/^error W9999 /);
  });
});
