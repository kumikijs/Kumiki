import { applyFixPlan, planFix, plural, runFixFromTest, runTests } from "@kumikijs/cli";
import { z } from "zod";
import { absPath, capsForInput, pathCapabilities } from "../input.ts";
import { blockedWire, failed, json, serialiseFixFromTest, text, toDiagnostics } from "../wire.ts";
import type { RegisterTool } from "./registrar.ts";

export function registerRepairTools(tool: RegisterTool): void {
  tool(
    "kumiki_fix",
    {
      title: "Plan or apply rule-based auto-fixes",
      description:
        'Typecheck a file and either propose auto-patches for repairable errors (e.g. misspelled names) or write them to disk. Default is dry-run (`apply: false`); pass `apply: true` to close the loop and persist the fixes. On apply, returns `{ applied, before, after, remaining }` with the residual diagnostics after re-typechecking. A refused write leaves the file unchanged with `applied: 0`, and `blocked.reason` says why: `introduced` (with the diagnostics the repair would have added), `resolved-none` or `parse-error` (with the parser `message`) from the regression gate, or `locked` (with the refusal `message`) when the repair changes a definition another agent holds an ownership lock on. Use `only` (e.g. "E0103") to restrict to a single diagnostic code.',
      inputSchema: {
        path: z.string(),
        apply: z
          .boolean()
          .optional()
          .describe("Write patches to disk. Default false = dry-run planning."),
        only: z
          .string()
          .optional()
          .describe('Restrict to a specific diagnostic code (e.g. "E0103").'),
        capabilities: pathCapabilities,
      },
    },
    async (input) => {
      const abs = absPath(input.path);
      const caps = capsForInput(input);
      if (input.apply) {
        const r = applyFixPlan(abs, input.only, caps);
        const body = json({
          applied: r.applied,
          before: r.before,
          after: r.after,
          remaining: toDiagnostics(r.remaining),
          warnings: toDiagnostics(r.warnings),
          ...(r.parseError ? { parseError: r.parseError } : {}),
          ...(r.regressionBlocked ? { regressionBlocked: r.regressionBlocked } : {}),
          ...(r.blocked ? { blocked: blockedWire(r.blocked) } : {}),
          ...(r.writeError ? { writeError: r.writeError } : {}),
        });
        return r.remaining.length > 0 ? failed(body) : text(body);
      }
      const plan = planFix(abs, input.only, caps);
      const advisory = plan.warnings.map((w) => `${w.code} ${w.message}`);
      if (plan.errors.length === 0) {
        if (plan.warnings.length === 0) return text("no errors");
        return text([`no errors (${plural(plan.warnings.length)})`, ...advisory].join("\n"));
      }
      if (plan.patches.length === 0) {
        return failed(
          [
            "(no auto-patches available)",
            ...plan.errors.map((e) => `${e.code} ${e.message}`),
            ...advisory,
          ].join("\n"),
        );
      }
      const proposals = plan.patches.map((p) => `${p.code}: ${p.description}`);
      const unrepaired = plan.skipped.map((s) => `${s.code}: ${s.message} (no auto-patch)`);
      return failed([...proposals, ...unrepaired, ...advisory].join("\n"));
    },
  );

  tool(
    "kumiki_auto_patch",
    {
      title: "Fix a failing test (behavioral auto-patch)",
      description:
        "Repair a .kumiki file from a specific failing `test` definition. Two tiers: (1) if the file has compile errors blocking the test, rule-based fixes (planFixes) are proposed/applied first; (2) if the file compiles but the test fails, a deterministic literal repair is proposed/applied when one is provable. Default is dry-run (`apply: false`). On apply, the behavioural patch is written only when the patched source compiles, the named test passes, no test that passed before fails and it changes no definition another agent holds an ownership lock on; otherwise the outcome is `test-blocked` and the patch is not written — the file is as tier (1) left it (unchanged when `compileFixes` is absent; carrying those compile fixes when present) — and `blocked.reason` says why: `parse-error`, `introduced` (with its diagnostics), `test-runner-threw` (with the runner's `message`), `named-test-missing`, `still-fails` (with the test's result), `regressed` (with the test names) or `locked` (with the refusal `message`). A dry run proposes the patch without running this gate. Returns a structured `FixFromTestOutcome` — inspect `status` (`already-pass` | `proposed` | `applied` | `test-blocked` | `compile-proposed` | `compile-blocked` | `compile-remaining` | `no-patch` | `not-found` | `write-failed`). `compile-blocked` means a tier-1 repair was found and refused — the file is unchanged, `compileErrors` is what it still has, and `blocked.reason` says which condition refused it: `introduced` (with the diagnostics it would have added), `resolved-none` or `parse-error` (with the parser's `message` — a repair rule emitted source that does not parse, which is a compiler-side defect rather than a pointless repair) from the regression gate, or `locked` (with the refusal `message`) when the repair changes a definition another agent holds an ownership lock on. `write-failed` carries `phase` (`compile` | `test`) and a raw `writeError` message; the write that threw landed nothing (on a `test`-phase failure, the compile fixes counted in `compileFixes` were written earlier and stay).",
      inputSchema: {
        path: z.string(),
        testName: z.string().describe("The name of the failing `test` definition to fix."),
        apply: z
          .boolean()
          .optional()
          .describe("Write the patch to disk. Default false = propose only."),
        capabilities: pathCapabilities,
      },
    },
    async (input) => {
      const apply = input.apply === true;
      const outcome = await runFixFromTest(
        absPath(input.path),
        input.testName,
        apply,
        capsForInput(input),
      );
      const body = json(serialiseFixFromTest(outcome));
      const repaired = outcome.status === "already-pass" || (apply && outcome.ok);
      return repaired ? text(body) : failed(body);
    },
  );

  tool(
    "kumiki_test",
    {
      title: "Run in-language tests",
      description:
        "Compile a Kumiki program with `test` definitions included, mount it in a headless DOM, run every `test`, and return a structured pass/fail report. Pass `filter` to restrict by exact name or a `prefix*` wildcard. This is the substrate for the fix loop: on failure, feed the failing test's name to `kumiki_auto_patch` to close the loop.",
      inputSchema: {
        path: z.string(),
        filter: z
          .string()
          .optional()
          .describe('Test name or `prefix*` wildcard (e.g. "reducer-*").'),
        capabilities: pathCapabilities,
      },
    },
    async (input) => {
      const report = await runTests(absPath(input.path), input.filter, capsForInput(input));
      const body = json({
        total: report.total,
        passed: report.passed,
        failed: report.failed,
        filter: report.filter ?? null,
        results: report.results,
      });
      const matchedNothing = report.filter !== undefined && report.total === 0;
      return report.failed > 0 || matchedNothing ? failed(body) : text(body);
    },
  );
}
