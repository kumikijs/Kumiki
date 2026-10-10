import type { AutoPatch, FixFromTestOutcome } from "@kumikijs/cli";
import { type KumikiError, type Severity, severityOf } from "@kumikijs/compiler";
import { CapabilityManifestError } from "@kumikijs/compiler/node";

export type Diagnostic = {
  code: string;
  kind: string;
  message: string;
  line: number;
  col: number;
  severity: Severity;
};

export const DIAGNOSTIC_SHAPE =
  'Each diagnostic is `{code, kind, message, line, col, severity}`; `severity` is `"error"` (the file fails `check` and `build`) or `"warning"` (advisory: reported, but fails neither; docs/spec/errors.md).';

export function text(...parts: string[]) {
  return { content: parts.map((s) => ({ type: "text" as const, text: s })) };
}

export function failed(s: string) {
  return { ...text(s), isError: true };
}

export function errText(e: unknown) {
  const kind = e instanceof CapabilityManifestError ? "capability-manifest" : "error";
  const message = e instanceof Error ? e.message : String(e);
  return failed(JSON.stringify({ error: { kind, message } }, null, 2));
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function toDiagnostics(errors: KumikiError[]): Diagnostic[] {
  return errors.map((e) => ({
    code: e.code,
    kind: e.kind,
    message: e.message,
    line: e.pos.line,
    col: e.pos.col,
    severity: severityOf(e),
  }));
}

export function serialiseFixFromTest(o: FixFromTestOutcome): Record<string, unknown> {
  const patchWire = (p: AutoPatch) => ({ code: p.code, description: p.description });
  const base = { ok: o.ok, status: o.status, warnings: toDiagnostics(o.warnings) };
  const withCompileFixes =
    "compileFixes" in o && o.compileFixes !== undefined ? { compileFixes: o.compileFixes } : {};
  switch (o.status) {
    case "no-patch":
      return {
        ...base,
        ...(o.compileErrors ? { compileErrors: toDiagnostics(o.compileErrors) } : {}),
        ...(o.testRunError ? { testRunError: o.testRunError } : {}),
        ...(o.failingTest ? { failingTest: o.failingTest } : {}),
        ...(o.reason ? { reason: o.reason } : {}),
        ...withCompileFixes,
      };
    case "compile-proposed":
      return {
        ...base,
        compileFixes: o.compileFixes,
        compilePatches: o.compilePatches.map(patchWire),
      };
    case "compile-blocked":
      return {
        ...base,
        compileErrors: toDiagnostics(o.compileErrors),
        blocked:
          o.blocked.reason === "introduced"
            ? { reason: o.blocked.reason, introduced: toDiagnostics(o.blocked.introduced) }
            : o.blocked.reason === "parse-error"
              ? { reason: o.blocked.reason, message: o.blocked.message }
              : { reason: o.blocked.reason },
      };
    case "compile-remaining":
      return {
        ...base,
        compileFixes: o.compileFixes,
        ...(o.compileErrors ? { compileErrors: toDiagnostics(o.compileErrors) } : {}),
      };
    case "not-found":
      return { ...base, availableTests: o.availableTests, ...withCompileFixes };
    case "already-pass":
      return { ...base, pass: o.pass, ...withCompileFixes };
    case "proposed":
      return { ...base, patch: patchWire(o.patch), ...withCompileFixes };
    case "applied":
      return {
        ...base,
        pass: o.pass,
        patch: patchWire(o.patch),
        regressed: o.regressed,
        ...withCompileFixes,
      };
    case "test-blocked": {
      const b = o.blocked;
      return {
        ...base,
        patch: patchWire(o.patch),
        blocked:
          b.reason === "introduced"
            ? { reason: b.reason, introduced: toDiagnostics(b.introduced) }
            : b,
        ...withCompileFixes,
      };
    }
    case "write-failed":
      return {
        ...base,
        phase: o.phase,
        writeError: o.writeError,
        ...withCompileFixes,
        ...(o.patch ? { patch: patchWire(o.patch) } : {}),
      };
    default: {
      const _exhaustive: never = o;
      throw new Error(`unhandled FixFromTestOutcome status: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
