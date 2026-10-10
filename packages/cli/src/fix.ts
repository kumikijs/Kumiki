import type { KumikiError } from "@kumikijs/compiler";
import { applyFixPlan, type FixApplyResult, planFix } from "./fix/compile.ts";
import { type FixFromTestOutcome, runFixFromTest } from "./fix/from-test.ts";
import { failureLines } from "./smoke.ts";

export {
  applyFixPlan,
  type FixApplyResult,
  type FixPlan,
  type GateVerdict,
  gateComposed,
  planFix,
  planFixes,
  planFixesExplained,
} from "./fix/compile.ts";
export { type FixFromTestOutcome, runFixFromTest, type TestPatchBlock } from "./fix/from-test.ts";
export type { AutoPatch, PatchAnchor, SkipReason } from "./fix/patch.ts";
export { iterStringLiterals, planTestPatch, planTestPatchExplained } from "./fix/test-patch.ts";

export function plural(n: number): string {
  return `${n} warning${n === 1 ? "" : "s"}`;
}

function verdict(headline: string, warnings: KumikiError[]): string {
  return warnings.length > 0 ? `${headline} (${plural(warnings.length)})` : headline;
}

/** The warnings themselves, under whatever verdict or diagnostic list precedes them. */
function reportWarnings(warnings: KumikiError[]): void {
  for (const w of warnings) console.error(`${w.code} ${w.message}`);
}

export function rollbackLine(r: {
  blocked?: FixApplyResult["blocked"];
  regressionBlocked?: boolean;
}): string {
  switch (r.blocked?.reason) {
    case "parse-error":
      return `fixes broke the file: ${r.blocked.message}`;
    case "resolved-none":
      return "(auto-patch rolled back — it resolved none of the reported diagnostics)";
    case "introduced": {
      const where = r.blocked.introduced
        .map((e) => `${e.code}@${e.pos.line}:${e.pos.col}`)
        .join(", ");
      return `(auto-patch rolled back — the re-check reported ${where}, which it did not before)`;
    }
    default:
      return r.regressionBlocked ? "(auto-patch rolled back)" : "(no auto-patches available)";
  }
}

export function fixCmd(
  path: string,
  apply: boolean,
  onlyCode?: string,
  capabilities: string[] = [],
): number {
  if (!apply) {
    const { errors, warnings, patches, skipped } = planFix(path, onlyCode, capabilities);
    if (errors.length === 0) {
      console.log(verdict("no errors", warnings));
      reportWarnings(warnings);
      return 0;
    }
    if (patches.length === 0) {
      console.log("(no auto-patches available)");
      for (const e of errors) console.error(`${e.code} ${e.message}`);
      reportWarnings(warnings);
      return 1;
    }
    for (const p of patches) {
      console.log(`${p.code} ${p.message}`);
      console.log(`  fix: ${p.description}`);
    }
    if (skipped.length > 0) {
      console.log(`(no auto-patch for ${skipped.length} of ${errors.length})`);
      for (const s of skipped) console.error(`${s.code} ${s.message} [${s.reason}]`);
    }
    reportWarnings(warnings);
    return 1;
  }
  const result = applyFixPlan(path, onlyCode, capabilities);
  if (result.applied === 0) {
    if (result.writeError) {
      console.error(`could not write fixes to ${path}: ${result.writeError}`);
      return 1;
    }
    if (result.remaining.length === 0) {
      console.log(verdict("no errors", result.warnings));
      reportWarnings(result.warnings);
      return 0;
    }
    console.log(rollbackLine(result));
    for (const e of result.remaining) console.error(`${e.code} ${e.message}`);
    reportWarnings(result.warnings);
    return 1;
  }
  if (result.remaining.length === 0) {
    console.log(verdict(`applied ${result.applied} fix(es) — file now clean`, result.warnings));
    reportWarnings(result.warnings);
    return 0;
  }
  console.log(`applied ${result.applied} fix(es) — ${result.remaining.length} error(s) remain`);
  for (const e of result.remaining) console.error(`${e.code} ${e.message}`);
  reportWarnings(result.warnings);
  return 1;
}

export async function fixFromTest(
  path: string,
  testName: string,
  apply: boolean,
  capabilities: string[] = [],
): Promise<FixFromTestOutcome> {
  const outcome = await runFixFromTest(path, testName, apply, capabilities);
  printFixFromTest(outcome, testName, path);
  reportWarnings(outcome.warnings);
  return outcome;
}

function printFixFromTest(outcome: FixFromTestOutcome, testName: string, path: string): void {
  if (
    outcome.status !== "compile-blocked" &&
    outcome.compileFixes !== undefined &&
    outcome.compileFixes > 0 &&
    outcome.status !== "compile-remaining" &&
    outcome.status !== "compile-proposed" &&
    !(outcome.status === "write-failed" && outcome.phase === "compile")
  ) {
    console.log(
      verdict(
        `applied ${outcome.compileFixes} compile fix(es) — file now compiles`,
        outcome.warnings,
      ),
    );
  }
  switch (outcome.status) {
    case "no-patch": {
      if (outcome.compileErrors && outcome.compileErrors.length > 0) {
        console.log(
          `(no auto-patch available) — test "${testName}" is blocked by ${outcome.compileErrors.length} compile error(s):`,
        );
        if (outcome.reason) console.log(`  reason: ${outcome.reason}`);
        for (const e of outcome.compileErrors) console.error(`  ${e.code} ${e.message}`);
        return;
      }
      if (outcome.testRunError) {
        console.error(`could not run tests: ${outcome.testRunError}`);
        if (outcome.reason) console.error(`  reason: ${outcome.reason}`);
        return;
      }
      if (outcome.failingTest) {
        console.log(`(no auto-patch available) for failing test "${testName}":`);
        for (const line of failureLines(outcome.failingTest)) console.log(line);
        if (outcome.reason) console.log(`  reason: ${outcome.reason}`);
        return;
      }
      console.log(`(no auto-patch available) for "${testName}"`);
      if (outcome.reason) console.log(`  reason: ${outcome.reason}`);
      return;
    }
    case "compile-proposed": {
      console.log(`test "${testName}" is blocked by compile errors; proposed fixes (dry-run):`);
      for (const p of outcome.compilePatches) {
        console.log(`  ${p.code} ${p.message}`);
        console.log(`    fix: ${p.description}`);
      }
      return;
    }
    case "compile-blocked": {
      console.log(rollbackLine({ ...outcome, regressionBlocked: true }));
      console.log(
        `test "${testName}" is still blocked by ${outcome.compileErrors.length} compile error(s):`,
      );
      for (const e of outcome.compileErrors) console.error(`  ${e.code} ${e.message}`);
      return;
    }
    case "compile-remaining": {
      const rem = outcome.compileErrors?.length ?? 0;
      console.log(
        `applied ${outcome.compileFixes} compile fix(es) — ${rem} error(s) remain; cannot run "${testName}"`,
      );
      return;
    }
    case "not-found": {
      const have = outcome.availableTests.join(", ") || "none";
      console.error(`no test named "${testName}" (have: ${have})`);
      return;
    }
    case "already-pass": {
      console.log(verdict(`test "${testName}" passes — nothing to fix`, outcome.warnings));
      return;
    }
    case "proposed": {
      console.log(`proposed fix for "${testName}" (dry-run):`);
      console.log(`  ${outcome.patch.description}`);
      return;
    }
    case "applied": {
      console.log(verdict(`applied fix — test "${testName}" now PASSES`, outcome.warnings));
      return;
    }
    case "test-blocked": {
      const kept = outcome.compileFixes
        ? "behavioural patch not written (compile fixes kept)"
        : "file left unchanged";
      console.log(`refused fix for "${testName}" — ${kept}:`);
      console.log(`  ${outcome.patch.description}`);
      console.log(`  reason: ${outcome.blocked.reason}`);
      const b = outcome.blocked;
      if (b.reason === "introduced")
        for (const e of b.introduced) console.error(`  ${e.code} ${e.message}`);
      else if (b.reason === "parse-error" || b.reason === "test-runner-threw")
        console.error(`  ${b.message}`);
      else if (b.reason === "regressed") console.log(`  would regress: ${b.regressed.join(", ")}`);
      else if (b.reason === "still-fails")
        for (const line of failureLines(b.failingTest)) console.log(line);
      return;
    }
    case "write-failed": {
      const what = outcome.phase === "compile" ? "compile fix" : "test patch";
      console.error(`could not write ${what} for "${testName}" (${path}): ${outcome.writeError}`);
      return;
    }
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`unhandled FixFromTestOutcome status: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
