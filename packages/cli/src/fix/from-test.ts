import { readFileSync } from "node:fs";
import type { KumikiError } from "@kumikijs/compiler";
import { check, lex, parse } from "@kumikijs/compiler";
import type { TestResult } from "@kumikijs/runtime";
import { runTestsSource, testFile } from "../smoke.ts";
import { load } from "../store.ts";
import { messageOf } from "../text.ts";
import {
  advisory,
  applyFixPlan,
  type FixApplyResult,
  planFixesExplained,
  repairable,
  writeFix,
} from "./compile.ts";
import type { AutoPatch, SkipReason } from "./patch.ts";
import { planTestPatchExplained, testBodyLineRanges } from "./test-patch.ts";

type FixFromTestStatus =
  | {
      ok: false;
      status: "no-patch";
      /** Compile-tier blockage: file has errors and none are auto-repairable. */
      compileErrors?: KumikiError[];
      /** Test runner threw before any test could execute. */
      testRunError?: string;
      /** Behavioral tier: the target test failed but no deterministic literal repair exists. */
      failingTest?: TestResult;
      reason?: string;
      compileFixes?: number;
    }
  | {
      ok: true;
      status: "compile-proposed";
      compileFixes: number;
      compilePatches: AutoPatch[];
    }
  | {
      ok: false;
      status: "compile-blocked";
      compileErrors: KumikiError[];
      blocked: NonNullable<FixApplyResult["blocked"]>;
    }
  | {
      ok: false;
      status: "compile-remaining";
      compileFixes: number;
      compileErrors?: KumikiError[];
    }
  | {
      ok: false;
      status: "not-found";
      availableTests: string[];
      compileFixes?: number;
    }
  | {
      ok: true;
      status: "already-pass";
      pass: true;
      compileFixes?: number;
    }
  | {
      ok: true;
      status: "proposed";
      patch: AutoPatch;
      compileFixes?: number;
    }
  | {
      ok: true;
      status: "applied";
      pass: true;
      patch: AutoPatch;
      regressed: [];
      compileFixes?: number;
    }
  | {
      ok: false;
      status: "test-blocked";
      patch: AutoPatch;
      blocked: TestPatchBlock;
      compileFixes?: number;
    }
  | {
      ok: false;
      status: "write-failed";
      phase: "compile" | "test";
      writeError: string;
      compileFixes?: number;
      patch?: AutoPatch;
    };

export type TestPatchBlock =
  | Extract<
      NonNullable<FixApplyResult["blocked"]>,
      { reason: "parse-error" | "introduced" | "locked" }
    >
  | { reason: "test-runner-threw"; message: string }
  | { reason: "named-test-missing" }
  | { reason: "still-fails"; failingTest: TestResult }
  | { reason: "regressed"; regressed: string[] };

export type FixFromTestOutcome = FixFromTestStatus & {
  warnings: KumikiError[];
};

function noCompilePatch(
  compileErrors: KumikiError[],
  skipped: SkipReason[],
): Extract<FixFromTestStatus, { status: "no-patch" }> {
  return {
    ok: false,
    status: "no-patch",
    compileErrors,
    reason: skipped[0]?.reason ?? "every-patch-declined",
  };
}

/** Repairs compile errors first (a file that does not compile cannot run its tests), then the named test. */
export async function runFixFromTest(
  path: string,
  testName: string,
  apply: boolean,
  capabilities: string[] = [],
): Promise<FixFromTestOutcome> {
  const store = load(path);
  const firstPass = check(store.program, { capabilities });
  const compileErrors = repairable(firstPass);
  let warnings = advisory(firstPass);
  const stamp = <T extends FixFromTestStatus>(o: T): T & { warnings: KumikiError[] } => ({
    ...o,
    warnings,
  });
  let compileFixes = 0;
  if (compileErrors.length > 0) {
    if (!apply) {
      const { patches, skipped } = planFixesExplained(store, compileErrors);
      if (patches.length === 0) return stamp(noCompilePatch(compileErrors, skipped));
      return stamp({
        ok: true,
        status: "compile-proposed",
        compileFixes: patches.length,
        compilePatches: patches,
      });
    }
    const result = applyFixPlan(path, undefined, capabilities);
    warnings = result.warnings;
    if (result.applied === 0) {
      if (result.writeError !== undefined) {
        return stamp({
          ok: false,
          status: "write-failed",
          phase: "compile",
          writeError: result.writeError,
          compileFixes: result.approved,
        });
      }
      if (result.blocked !== undefined) {
        return stamp({
          ok: false,
          status: "compile-blocked",
          compileErrors,
          blocked: result.blocked,
        });
      }
      return stamp(noCompilePatch(compileErrors, result.skipped));
    }
    compileFixes = result.applied;
    if (result.remaining.length > 0) {
      return stamp({
        ok: false,
        status: "compile-remaining",
        compileFixes,
        compileErrors: result.remaining,
      });
    }
  }
  const fixedCount = compileFixes ? { compileFixes } : {};

  let before: TestResult[];
  try {
    before = await testFile(path, capabilities);
  } catch (e) {
    return stamp({
      ok: false,
      status: "no-patch",
      testRunError: messageOf(e),
      reason: "test-runner-threw",
      ...fixedCount,
    });
  }
  const target = before.find((r) => r.name === testName);
  if (!target) {
    return stamp({
      ok: false,
      status: "not-found",
      availableTests: before.map((r) => r.name),
      ...fixedCount,
    });
  }
  if (target.pass) {
    return stamp({ ok: true, status: "already-pass", pass: true, ...fixedCount });
  }

  const curSource = readFileSync(path, "utf8");
  const curStore = load(path);
  const attempt = planTestPatchExplained(curSource, target, testBodyLineRanges(curStore), curStore);
  if (!attempt.patch) {
    return stamp({
      ok: false,
      status: "no-patch",
      failingTest: target,
      reason: attempt.reason,
      ...fixedCount,
    });
  }
  const patch = attempt.patch;
  if (!apply) {
    return stamp({ ok: true, status: "proposed", patch, ...fixedCount });
  }
  const patched = patch.apply(curSource);
  const refused = await gateTestPatch(patched, testName, before, path, capabilities);
  // Written by the compile tier's writer, so the ownership lock refuses it as it does a repair.
  const unwritten = refused === null ? writeFix(path, curSource, patched) : { blocked: refused };
  if (unwritten !== undefined && "blocked" in unwritten) {
    return stamp({
      ok: false,
      status: "test-blocked",
      patch,
      blocked: unwritten.blocked,
      ...fixedCount,
    });
  }
  if (unwritten !== undefined) {
    return stamp({
      ok: false,
      status: "write-failed",
      phase: "test",
      writeError: unwritten.writeError,
      patch,
      ...fixedCount,
    });
  }
  return stamp({ ok: true, status: "applied", pass: true, patch, regressed: [], ...fixedCount });
}

/** Refuses a test patch that breaks the file, leaves the test failing, or fails a passing test. */
async function gateTestPatch(
  patched: string,
  testName: string,
  before: readonly TestResult[],
  path: string,
  capabilities: string[],
): Promise<Exclude<TestPatchBlock, { reason: "locked" }> | null> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(lex(patched));
  } catch (e) {
    return { reason: "parse-error", message: messageOf(e) };
  }
  const introduced = repairable(check(parsed, { capabilities }));
  if (introduced.length > 0) return { reason: "introduced", introduced };
  let after: TestResult[];
  try {
    after = await runTestsSource(patched, capabilities, { sourcePath: path });
  } catch (e) {
    return { reason: "test-runner-threw", message: messageOf(e) };
  }
  const named = after.find((r) => r.name === testName);
  if (named === undefined) return { reason: "named-test-missing" };
  if (!named.pass) return { reason: "still-fails", failingTest: named };
  const regressed = before
    .filter((b) => b.pass && after.find((r) => r.name === b.name)?.pass !== true)
    .map((b) => b.name);
  if (regressed.length > 0) return { reason: "regressed", regressed };
  return null;
}
