import { HEADLESS_ACTION_KEYS, parseFailure, runScenarioSource, smokeSource } from "@kumikijs/cli";
import { check, compile, type KumikiError, lex, parse } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader, resolveBuiltinIcons } from "@kumikijs/compiler/node";
import { z } from "zod";
import {
  absPath,
  capsForInput,
  readSource,
  runCapabilities,
  sourceCapabilities,
} from "../input.ts";
import { DIAGNOSTIC_SHAPE, type Diagnostic, failed, json, text, toDiagnostics } from "../wire.ts";
import type { RegisterTool } from "./registrar.ts";

type Scenario = Parameters<typeof runScenarioSource>[1];

const ACTION_SHAPES: Record<(typeof HEADLESS_ACTION_KEYS)[number], string> = {
  dispatch: "{dispatch, payload?}",
  clickText: "{clickText}",
  click: "{click}",
  focus: "{focus}",
  blur: "{blur}",
  key: "{key, value}",
  hover: "{hover}",
  fill: "{fill, value}",
  choose: "{choose, value}",
  navigate: "{navigate}",
  submit: "{submit}",
  wait: "{wait}",
};
const SCENARIO_ACTIONS = HEADLESS_ACTION_KEYS.map((k) => ACTION_SHAPES[k]).join(", ");

type StrictCheckOpts = {
  strictA11y?: boolean;
  strictIcons?: boolean;
  strictSelectorId?: boolean;
  iconNames?: Iterable<string>;
};

function validate(
  source: string,
  capabilities: string[],
  opts: StrictCheckOpts,
): { ok: boolean; failing: boolean; diagnostics: Diagnostic[] } {
  let reported: KumikiError[];
  try {
    reported = check(parse(lex(source)), { capabilities, ...opts });
  } catch (e) {
    reported = [parseFailure(e)];
  }
  const diagnostics = toDiagnostics(reported);
  return {
    ok: diagnostics.length === 0,
    // `kumiki check` exits 0 on warnings alone; this mirrors it, read off the
    // payload so `isError` and the payload cannot disagree.
    failing: diagnostics.some((d) => d.severity === "error"),
    diagnostics,
  };
}

export function registerCompileTools(tool: RegisterTool): void {
  tool(
    "kumiki_check",
    {
      title: "Check Kumiki source",
      description: `Parse and typecheck a Kumiki program. Pass \`source\` (text) or \`path\` (file). Returns ok, or a JSON list of diagnostics (codes: docs/spec/errors.md) that is flagged \`isError\` only when one of them has \`severity\` \`"error"\`. ${DIAGNOSTIC_SHAPE} The \`strict*\` toggles surface diagnostics that are hidden by default: \`strictA11y\` (E0701..E0703), \`strictIcons\` (E0704), \`strictSelectorId\` (E0212). With \`path\` + \`strictIcons\`, @kumikijs/icons is resolved to widen the icon-name domain; when the package isn't installed, only theme.icons is used.`,
      inputSchema: {
        source: z.string().optional().describe("Full Kumiki source text"),
        path: z.string().optional().describe("Path to a .kumiki file (relative to cwd)"),
        capabilities: sourceCapabilities,
        strictA11y: z
          .boolean()
          .optional()
          .describe("Emit a11y diagnostics (E0701..E0703) that are hidden by default."),
        strictIcons: z
          .boolean()
          .optional()
          .describe("Emit E0704 for icon names outside the resolved icon domain."),
        strictSelectorId: z
          .boolean()
          .optional()
          .describe("Emit E0212 (selector-id) diagnostics that are hidden by default."),
      },
    },
    async (input) => {
      const strictOpts: StrictCheckOpts = {
        ...(input.strictA11y ? { strictA11y: true } : {}),
        ...(input.strictIcons ? { strictIcons: true } : {}),
        ...(input.strictSelectorId ? { strictSelectorId: true } : {}),
      };
      if (input.strictIcons && input.path) {
        const registry = await resolveBuiltinIcons(absPath(input.path));
        if (registry) strictOpts.iconNames = Object.keys(registry);
      }
      const result = validate(readSource(input), capsForInput(input), strictOpts);
      if (result.ok) return text("ok — no diagnostics");
      const body = json(result.diagnostics);
      return result.failing ? failed(body) : text(body);
    },
  );

  tool(
    "kumiki_build",
    {
      title: "Build Kumiki source",
      description: `Compile a Kumiki program to a self-contained JS module (runtime inlined). Pass \`source\` or \`path\`. Returns the generated JS, or \`build failed:\` followed by a JSON list of the diagnostics that failed it. ${DIAGNOSTIC_SHAPE}`,
      inputSchema: {
        source: z.string().optional(),
        path: z.string().optional(),
        includeJs: z.boolean().optional().describe("Return full JS (default: only a summary)"),
        capabilities: sourceCapabilities,
      },
    },
    async (input) => {
      const result = compile(readSource(input), {
        runtimeSpecifier: "./runtime.js",
        bundle: true,
        readRuntimeBundle: nodeRuntimeBundleReader,
        capabilities: capsForInput(input),
      });
      if (result.kind === "fail") {
        return failed(`build failed:\n${json(toDiagnostics(result.errors))}`);
      }
      if (input.includeJs) return text(result.js);
      return text(
        `build ok — ${result.js.length} bytes of JS (pass includeJs=true for the source)`,
      );
    },
  );

  tool(
    "kumiki_smoke",
    {
      title: "Runtime smoke test",
      description:
        "Mount a Kumiki program in a headless DOM, exercise its UI, and report runtime failures that check/build cannot catch (throws, empty render, unhandled rejections). Pass `source` or `path`. Run this after check/build — a program can compile yet error or render nothing when actually used.",
      inputSchema: {
        source: z.string().optional(),
        path: z.string().optional(),
        capabilities: runCapabilities,
      },
    },
    async (input) => {
      const report = await smokeSource(readSource(input), capsForInput(input));
      if (report.ok) {
        return text(
          `ok — mounted, rendered, ${report.interactions} interaction(s), no runtime errors`,
        );
      }
      const lines = report.issues.map(
        (i) => `[${i.phase}] ${i.message}${i.trigger ? ` (on ${i.trigger})` : ""}`,
      );
      return failed(
        `runtime smoke failed (mounted=${report.mounted}, rendered=${report.rendered}):\n${lines.join("\n")}`,
      );
    },
  );

  tool(
    "kumiki_run_scenario",
    {
      title: "Run a scenario",
      description: `Drive a Kumiki app through a scenario and return a per-step trace (slot state, DOM text, errors, emitted effects) plus assertion results. A step whose action could not run — a selector matching nothing, a \`fill\` aimed at an element that holds no text, a control the platform refuses to drive (\`disabled\` refuses any verb that drives a control; \`readonly\` and an editable's \`contenteditable="false"\` refuse the typing alone, so \`fill\` only; \`hover\` is never refused), or a {submit} the form holds back because a bound field fails its validation — reports \`action failed:\` instead of an error, and fails: the action never ran, so that step's state is not a state the app reached through it, and \`errorIncludes\` cannot claim it. This is the substrate for an autonomous generate→run→observe→**fix** loop: write the user's requirements as scenario steps with \`expect\` assertions on state, run, read the trace, then close the loop without a human operating the app — on a failing test, call \`kumiki_auto_patch { apply: true, testName }\` (test-driven, deterministic literal repair); on a compile diagnostic, call \`kumiki_fix { apply: true }\` (rule-based).\n\nScenario shape: { steps: [{ label?, do?, expect? }], effects?: { <name>: [{outcome, value}] } }. An action \`do\` is one of: ${SCENARIO_ACTIONS}. {focus} / {blur} / {key} / {hover} dispatch the real DOM event, so a scenario alone verifies the listener wiring a \`ui.<event>\` reducer depends on. An \`expect\` is { noErrors?, errorIncludes?: [..], actionErrorIncludes?: [..], state?: {slot: value}, domIncludes?: [..], domExcludes?: [..] } (state uses partial match; keys may be dotted paths; \`errorIncludes\` asserts an error WAS reported, for contracts whose point is that the runtime surfaces something; \`actionErrorIncludes\` asserts the step was REFUSED, for a control the platform will not drive or a {submit} the form held back because a bound field fails its validation; it matches the refusal alone, so a step that ran, or that failed for another reason such as a selector matching nothing, fails rather than claiming one).`,
      inputSchema: {
        source: z.string().optional(),
        path: z.string().optional(),
        scenario: z
          .object({
            steps: z.array(z.record(z.string(), z.unknown())),
            effects: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).optional(),
            defaultEffect: z.record(z.string(), z.unknown()).optional(),
          })
          .describe("The scenario to run"),
        capabilities: runCapabilities,
      },
    },
    async (input) => {
      const report = await runScenarioSource(
        readSource(input),
        input.scenario as unknown as Scenario,
        capsForInput(input),
      );
      const lines = report.steps.map((s, i) => {
        const status = s.ok ? "ok" : "FAIL";
        const head = `step ${i}${s.label ? ` (${s.label})` : ""}${s.action ? `: ${s.action}` : ""}`;
        const sub = [
          ...(s.actionError !== undefined ? [`    action failed: ${s.actionError}`] : []),
          ...s.errors.map((e) => `    error: ${e}`),
          ...s.expectedErrors.map((e) => `    expected error: ${e}`),
          ...(s.expectedActionError !== undefined
            ? [`    expected refusal: ${s.expectedActionError}`]
            : []),
          ...s.failures.map((f) => `    assert: ${f}`),
        ];
        const emits = s.emits.length ? `    emits: ${s.emits.map((e) => e.effect).join(", ")}` : "";
        return [`[${status}] ${head}`, ...sub, emits].filter(Boolean).join("\n");
      });
      const tail = report.ok ? "scenario passed" : "scenario FAILED";
      const finalState = report.steps.at(-1)?.state ?? {};
      const body = `${lines.join("\n")}\n\n${tail}\nfinal state: ${JSON.stringify(finalState)}`;
      return report.ok ? text(body) : failed(body);
    },
  );
}
