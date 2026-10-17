import type { AutoPatch, FixApplyResult, FixFromTestOutcome, TestPatchBlock } from "@kumikijs/cli";
import type { KumikiError } from "@kumikijs/compiler";
import { CapabilityManifestError } from "@kumikijs/compiler/node";

export type Diagnostic = { code: string; kind: string; message: string; line: number; col: number };

export function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
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
  }));
}

/** Each `reason` keeps its own payload, so reading `reason` alone is never misleading. */
export function blockedWire(
  b: NonNullable<FixApplyResult["blocked"]> | TestPatchBlock,
): Record<string, unknown> {
  return b.reason === "introduced"
    ? { reason: b.reason, introduced: toDiagnostics(b.introduced) }
    : b;
}

export function serialiseFixFromTest(o: FixFromTestOutcome): Record<string, unknown> {
  const patchWire = (p: AutoPatch) => ({ code: p.code, description: p.description });
  const base = { ok: o.ok, status: o.status };
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
        blocked: blockedWire(o.blocked),
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
    case "test-blocked":
      return {
        ...base,
        patch: patchWire(o.patch),
        blocked: blockedWire(o.blocked),
        ...withCompileFixes,
      };
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
