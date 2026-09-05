// Kumiki MCP server — exposes the compiler and AI-edit toolchain as MCP tools.
//
// Tools fall into three groups:
//   * source / file validation  (check, build)
//   * project navigation + edits (list, view, refs, add, replace, remove, rename, fix)
//   * spec access                (spec_search, spec_list, spec_get)

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addDef,
  applyFixPlan,
  describeEdit,
  editDef,
  episodeLogPathFor,
  findReferences,
  HEADLESS_ACTION_KEYS,
  LAYERS,
  listDefs,
  load,
  planFix,
  plural,
  removeDef,
  renameDef,
  replaceDef,
  runFixFromTest,
  runScenarioSource,
  runTests,
  smokeSource,
  viewDef,
  viewHistory,
  viewWithDeps,
} from "@kumikijs/cli";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type Scenario = Parameters<typeof runScenarioSource>[1];

import type { AutoPatch, FixFromTestOutcome } from "@kumikijs/cli";
import type { KumikiError } from "@kumikijs/compiler";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import {
  CapabilityManifestError,
  nodeRuntimeBundleReader,
  resolveBuiltinIcons,
  resolveCapabilities,
} from "@kumikijs/compiler/node";
import { z } from "zod";
import { getSpecDoc, listSpecDocs, searchSpec } from "./spec.ts";

type Diagnostic = { code: string; kind: string; message: string; line: number; col: number };

/**
 * The shape of each scenario action, for the one surface an agent reads before
 * writing a scenario. Keyed by the runner's own action set, so an action added
 * there and forgotten here is a compile error rather than an action no caller
 * of this tool knows exists — this description had drifted by six of them, and
 * the set is closed, so an action missing from it is unreachable in practice.
 */
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

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/**
 * A tool answer that reports failure.
 *
 * The content is whatever the caller asked for — the diagnostics, the smoke
 * report, the scenario trace — and `isError` is the one field a client can
 * branch on without reading prose. The rule, so that no tool needs its own:
 * **`isError` is set exactly when the matching CLI verb would exit non-zero**
 * (docs/spec/ai-edit.md §9.2.5). `build failed:` and `scenario FAILED` exist
 * only as sentences, so without this an agent driving generate → check → fix
 * over MCP reads a failed build as a finished one.
 */
function failed(s: string) {
  return { ...text(s), isError: true };
}

/**
 * Resolve `path` for a tool that reads a sidecar rather than the file itself.
 *
 * The op-log and the episode log are separate files, so those tools never open
 * the `.kumiki` — and answered "(no history)" / "(no episode log)" for a path
 * that was never there, which is exactly what an app nobody has edited or run
 * yet looks like. The source file is required to exist; the sidecar's absence
 * stays an ordinary answer.
 */
function requireSourceFile(path: string): string {
  const abs = resolve(process.cwd(), path);
  if (!existsSync(abs)) throw new Error(`File "${abs}" not found`);
  return abs;
}

function readSource(input: { source?: string | undefined; path?: string | undefined }): string {
  if (typeof input.source === "string") return input.source;
  if (input.path) return readFileSync(resolve(process.cwd(), input.path), "utf8");
  throw new Error("provide either `source` or `path`");
}

/**
 * Registered capabilities for an input: from the nearest `kumiki.caps.json` at
 * or above a `path` (searched up to the project root), or an explicit
 * `capabilities` list when only `source` is given.
 */
function capsForInput(input: {
  path?: string | undefined;
  capabilities?: string[] | undefined;
}): string[] {
  if (input.path) return resolveCapabilities(resolve(process.cwd(), input.path));
  return input.capabilities ?? [];
}

/**
 * Uniform JSON error envelope for tool responses. Success responses use their
 * own JSON shape (e.g. `{ total, passed, ... }`); a client that always
 * `JSON.parse`s the tool output would otherwise hit an exception on the
 * failure path with the older `"error: <msg>"` plain-text form.
 *
 * `isError` is the field the protocol gives clients to branch on, and it has to
 * agree with the envelope: a caught failure returned without it reported
 * success for a file that does not exist, while the same failure in a tool with
 * no catch reached the SDK and came back flagged. A client branching on
 * `isError` saw half its failures as results.
 */
function errText(e: unknown) {
  const kind = e instanceof CapabilityManifestError ? "capability-manifest" : "error";
  const message = e instanceof Error ? e.message : String(e);
  return { ...text(JSON.stringify({ error: { kind, message } }, null, 2)), isError: true };
}

/**
 * Serialise a `FixFromTestOutcome` for the MCP wire: drop the un-serialisable
 * `apply` closure from every `AutoPatch`, convert `KumikiError[]` →
 * `Diagnostic[]`, and preserve the discriminated union so the client can
 * `switch (r.status)` on the response. The `applied` variant always carries
 * `regressed: string[]` (may be empty) — the client never has to fall back to
 * `?? []`.
 */
function serialiseFixFromTest(o: FixFromTestOutcome): Record<string, unknown> {
  const patchWire = (p: AutoPatch) => ({ code: p.code, description: p.description });
  const base = { ok: o.ok, status: o.status };
  switch (o.status) {
    case "no-patch":
      return {
        ...base,
        ...(o.compileErrors ? { compileErrors: toDiagnostics(o.compileErrors) } : {}),
        ...(o.testRunError ? { testRunError: o.testRunError } : {}),
        ...(o.failingTest ? { failingTest: o.failingTest } : {}),
        ...(o.reason ? { reason: o.reason } : {}),
        ...(o.compileFixes !== undefined ? { compileFixes: o.compileFixes } : {}),
      };
    case "compile-proposed":
      return {
        ...base,
        compileFixes: o.compileFixes,
        compilePatches: o.compilePatches.map(patchWire),
      };
    case "compile-blocked":
      // `compileErrors` is the author's own set; `blocked` is what the refused
      // patch would have done. A client that merged the two would report a
      // diagnostic that is not in the file. Each `reason` keeps its own
      // payload, so reading `reason` alone is never misleading.
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
      return {
        ...base,
        availableTests: o.availableTests,
        ...(o.compileFixes !== undefined ? { compileFixes: o.compileFixes } : {}),
      };
    case "already-pass":
      return {
        ...base,
        pass: o.pass,
        ...(o.compileFixes !== undefined ? { compileFixes: o.compileFixes } : {}),
      };
    case "proposed":
      return {
        ...base,
        patch: patchWire(o.patch),
        ...(o.compileFixes !== undefined ? { compileFixes: o.compileFixes } : {}),
      };
    case "applied":
      return {
        ...base,
        pass: o.pass,
        patch: patchWire(o.patch),
        regressed: o.regressed,
        ...(o.compileFixes !== undefined ? { compileFixes: o.compileFixes } : {}),
      };
    case "write-failed":
      // I/O failure surfaces on the wire so MCP callers see it as a
      // structured outcome rather than a transport-level error. `phase`
      // distinguishes the two write sites; `patch` only appears on
      // phase="test" (the tier-2 proposal that never landed).
      return {
        ...base,
        phase: o.phase,
        writeError: o.writeError,
        ...(o.compileFixes !== undefined ? { compileFixes: o.compileFixes } : {}),
        ...(o.patch ? { patch: patchWire(o.patch) } : {}),
      };
    default: {
      // Exhaustiveness guard: a new variant on `FixFromTestOutcome` without a
      // matching case here becomes a TS compile error.
      const _exhaustive: never = o;
      throw new Error(`unhandled FixFromTestOutcome status: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

type Episode = {
  id?: string;
  trigger?: { kind?: string; target?: string };
  status?: string;
  steps?: unknown[];
};

type EpisodeLogRead = {
  entries: Episode[];
  /** Number of non-blank JSONL lines that failed to parse. */
  skipped: number;
  /** 1-based line number of the first malformed line, if any. */
  firstMalformedLine?: number;
};

/**
 * Read a `<file>.kumiki-episodes.jsonl` log into a chronological (append-order)
 * array. Malformed JSONL lines are counted (not silently dropped) so callers
 * can surface a warning — a log written by a long-running process may end
 * mid-write, which is expected; arbitrary bad lines usually mean the runtime
 * logger produced garbage, and hiding that would mask the real bug.
 */
function readEpisodeLog(logPath: string): EpisodeLogRead {
  const lines = readFileSync(logPath, "utf8").split(/\r?\n/);
  const entries: Episode[] = [];
  let skipped = 0;
  let firstMalformedLine: number | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as Episode);
    } catch {
      skipped++;
      if (firstMalformedLine === undefined) firstMalformedLine = i + 1;
    }
  }
  return {
    entries,
    skipped,
    ...(firstMalformedLine !== undefined ? { firstMalformedLine } : {}),
  };
}

function buildEpisodeWarnings(
  skipped: number,
  firstMalformedLine: number | undefined,
): Array<{ kind: string; message: string }> {
  return [
    {
      kind: "malformed-jsonl",
      message:
        firstMalformedLine !== undefined
          ? `skipped ${skipped} malformed line(s); first at line ${firstMalformedLine}`
          : `skipped ${skipped} malformed line(s)`,
    },
  ];
}

function toDiagnostics(errors: KumikiError[]): Diagnostic[] {
  return errors.map((e) => ({
    code: e.code,
    kind: e.kind,
    message: e.message,
    line: e.pos.line,
    col: e.pos.col,
  }));
}

type StrictCheckOpts = {
  strictA11y?: boolean;
  strictIcons?: boolean;
  strictSelectorId?: boolean;
  iconNames?: Iterable<string>;
};

/** Parse + typecheck, normalizing parse exceptions into a single diagnostic. */
function validate(
  source: string,
  capabilities: string[] = [],
  opts: StrictCheckOpts = {},
): { ok: boolean; failing: boolean; diagnostics: Diagnostic[] } {
  try {
    const program = parse(lex(source));
    const errors = check(program, { capabilities, ...opts });
    return {
      ok: errors.length === 0,
      // A warning is reported and does not fail — the same split `kumiki
      // check` makes when it prints `ok (1 warning)` and exits 0.
      failing: errors.some((e) => e.severity !== "warning"),
      diagnostics: toDiagnostics(errors),
    };
  } catch (e) {
    const pe = e as { message?: string; pos?: { line: number; col: number } };
    return {
      ok: false,
      failing: true,
      diagnostics: [
        {
          code: "E0000",
          kind: "parse-error",
          message: pe.message ?? String(e),
          line: pe.pos?.line ?? 0,
          col: pe.pos?.col ?? 0,
        },
      ],
    };
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "kumiki", version: "0.1.0" });

  /**
   * Register a tool whose failures always leave through `errText`.
   *
   * Wrapping at registration rather than inside each handler is the point: a
   * per-handler `try` is something a new tool can be written without, and
   * that is exactly how half of these ended up reporting a missing file as a
   * successful result while the other half reported it as an error.
   *
   * The assertion is the price of implementing a callback type whose
   * parameters depend on a type variable: `ToolCallback<InputArgs>` resolves
   * to concrete parameters only once `InputArgs` is, and every call site below
   * supplies one. The explicit return type keeps the assertion from covering
   * what this function returns as well — without it the `catch` arm is checked
   * against an unresolved conditional type, which accepts anything.
   */
  const tool = <InputArgs extends ZodRawShapeCompat>(
    name: string,
    config: { title: string; description: string; inputSchema: InputArgs },
    handler: ToolCallback<InputArgs>,
  ): void => {
    server.registerTool(name, config, (async (args, extra): Promise<CallToolResult> => {
      try {
        return await handler(args, extra);
      } catch (e) {
        return errText(e);
      }
    }) as ToolCallback<InputArgs>);
  };

  tool(
    "kumiki_check",
    {
      title: "Check Kumiki source",
      description:
        "Parse and typecheck a Kumiki program. Pass `source` (text) or `path` (file). Returns ok or a list of diagnostics with codes (see docs/spec/errors.md). The `strict*` toggles surface diagnostics that are hidden by default: `strictA11y` (E0701..E0703), `strictIcons` (E0704), `strictSelectorId` (E0212). With `path` + `strictIcons`, @kumikijs/icons is resolved to widen the icon-name domain; when the package isn't installed, only theme.icons is used.",
      inputSchema: {
        source: z.string().optional().describe("Full Kumiki source text"),
        path: z.string().optional().describe("Path to a .kumiki file (relative to cwd)"),
        capabilities: z
          .array(z.string())
          .optional()
          .describe(
            "Project-registered capabilities accepted in app.caps (when passing `source`). With `path`, the nearest kumiki.caps.json at or above it is read automatically.",
          ),
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
        const registry = await resolveBuiltinIcons(resolve(process.cwd(), input.path));
        if (registry) strictOpts.iconNames = Object.keys(registry);
      }
      const result = validate(readSource(input), capsForInput(input), strictOpts);
      if (result.ok) return text("ok — no diagnostics");
      const body = JSON.stringify(result.diagnostics, null, 2);
      return result.failing ? failed(body) : text(body);
    },
  );

  tool(
    "kumiki_build",
    {
      title: "Build Kumiki source",
      description:
        "Compile a Kumiki program to a self-contained JS module (runtime inlined). Pass `source` or `path`. Returns the generated JS, or diagnostics on failure.",
      inputSchema: {
        source: z.string().optional(),
        path: z.string().optional(),
        includeJs: z.boolean().optional().describe("Return full JS (default: only a summary)"),
        capabilities: z
          .array(z.string())
          .optional()
          .describe(
            "Project-registered capabilities accepted in app.caps (when passing `source`). With `path`, the nearest kumiki.caps.json at or above it is read automatically.",
          ),
      },
    },
    async (input) => {
      const source = readSource(input);
      const result = compile(source, {
        runtimeSpecifier: "./runtime.js",
        bundle: true,
        readRuntimeBundle: nodeRuntimeBundleReader,
        capabilities: capsForInput(input),
      });
      if (result.kind === "fail") {
        return failed(`build failed:\n${JSON.stringify(toDiagnostics(result.errors), null, 2)}`);
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
        capabilities: z
          .array(z.string())
          .optional()
          .describe(
            "Project-registered capabilities (when passing `source`). With `path`, the nearest kumiki.caps.json at or above it is read automatically.",
          ),
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
      description: `Drive a Kumiki app through a scenario and return a per-step trace (slot state, DOM text, errors, emitted effects) plus assertion results. This is the substrate for an autonomous generate→run→observe→**fix** loop: write the user's requirements as scenario steps with \`expect\` assertions on state, run, read the trace, then close the loop without a human operating the app — on a failing test, call \`kumiki_auto_patch { apply: true, testName }\` (test-driven, deterministic literal repair); on a compile diagnostic, call \`kumiki_fix { apply: true }\` (rule-based).\n\nScenario shape: { steps: [{ label?, do?, expect? }], effects?: { <name>: [{outcome, value}] } }. An action \`do\` is one of: ${SCENARIO_ACTIONS}. {focus} / {blur} / {key} / {hover} dispatch the real DOM event, so a scenario alone verifies the listener wiring a \`ui.<event>\` reducer depends on. An \`expect\` is { noErrors?, errorIncludes?: [..], state?: {slot: value}, domIncludes?: [..], domExcludes?: [..] } (state uses partial match; keys may be dotted paths; \`errorIncludes\` asserts an error WAS reported, for contracts whose point is that the runtime surfaces something).`,
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
        capabilities: z
          .array(z.string())
          .optional()
          .describe(
            "Project-registered capabilities (when passing `source`). With `path`, the nearest kumiki.caps.json at or above it is read automatically.",
          ),
      },
    },
    async (input) => {
      const report = await runScenarioSource(
        readSource(input),
        input.scenario as unknown as Scenario,
        capsForInput(input),
      );
      const lines = report.steps.map((s, i) => {
        const status =
          s.errors.length === 0 && s.failures.length === 0 && s.actionError === undefined
            ? "ok"
            : "FAIL";
        const head = `step ${i}${s.label ? ` (${s.label})` : ""}${s.action ? `: ${s.action}` : ""}`;
        const sub = [
          // The step did nothing: an agent reading this must not diagnose the
          // app from a state the action never reached.
          ...(s.actionError !== undefined ? [`    action failed: ${s.actionError}`] : []),
          ...s.errors.map((e) => `    error: ${e}`),
          // An error the step's `errorIncludes` asked for is out of `errors`,
          // so without this line the agent driving the fix loop reads a step
          // that reported something as one that reported nothing.
          ...s.expectedErrors.map((e) => `    expected error: ${e}`),
          ...s.failures.map((f) => `    assert: ${f}`),
        ];
        const emits = s.emits.length ? `    emits: ${s.emits.map((e) => e.effect).join(", ")}` : "";
        return [`[${status}] ${head}`, ...sub, emits].filter(Boolean).join("\n");
      });
      const tail = report.ok ? "scenario passed" : "scenario FAILED";
      // Include the final state snapshot to help the agent diagnose.
      const finalState = report.steps.at(-1)?.state ?? {};
      const body = `${lines.join("\n")}\n\n${tail}\nfinal state: ${JSON.stringify(finalState)}`;
      return report.ok ? text(body) : failed(body);
    },
  );

  tool(
    "kumiki_list",
    {
      title: "List definitions",
      description: "List the definitions in a .kumiki file, optionally filtered by layer.",
      inputSchema: {
        path: z.string().describe("Path to a .kumiki file"),
        // Derived from the labels the store puts on definitions, so this
        // filter and `kumiki list <layer>` accept the same set. Written out
        // here, it omitted `test` and `motion` — definitions the tool listed
        // but could not filter to.
        layer: z.enum(LAYERS).optional(),
      },
    },
    async ({ path, layer }) => {
      const store = load(resolve(process.cwd(), path));
      const entries = listDefs(store, layer).map(
        (e) => `${e.layer}.${e.name}  (lines ${e.range.startLine}-${e.range.endLine})`,
      );
      return text(entries.join("\n") || "(no definitions)");
    },
  );

  tool(
    "kumiki_view",
    {
      title: "View a definition",
      description:
        "Show the source of one definition (`<layer>.<name>`), optionally with its dependencies.",
      inputSchema: {
        path: z.string(),
        name: z.string().describe("Qualified name, e.g. tile.App or reducer.addTodo"),
        withDeps: z.boolean().optional(),
      },
    },
    async ({ path, name, withDeps }) => {
      const store = load(resolve(process.cwd(), path));
      const out = withDeps ? viewWithDeps(store, name) : viewDef(store, name);
      if (out === null) throw new Error(`Definition "${name}" not found`);
      return text(out);
    },
  );

  tool(
    "kumiki_refs",
    {
      title: "Find references",
      description: "Find all sites that reference a definition.",
      inputSchema: { path: z.string(), name: z.string() },
    },
    async ({ path, name }) => {
      const store = load(resolve(process.cwd(), path));
      // "(no references)" for a name that is not defined reads as "safe to
      // delete", which is the opposite of what a typo'd name means. Same
      // answer as `kumiki_view` gives to the same question.
      if (!store.byQName.has(name)) throw new Error(`Definition "${name}" not found`);
      const refs = findReferences(store, name).map((r) => `${r.qname} @ line ${r.line}`);
      return text(refs.join("\n") || "(no references)");
    },
  );

  tool(
    "kumiki_add",
    {
      title: "Add a definition",
      description: "Append a new definition to a .kumiki file. Returns the new op-id.",
      inputSchema: {
        path: z.string(),
        layer: z.enum(["type", "slot", "effect", "reducer", "tile", "fn", "app", "theme"]),
        name: z.string(),
        body: z.string().describe("The definition body (without the `<layer> <name>` prefix)"),
      },
    },
    async ({ path, layer, name, body }) => {
      const opId = addDef(resolve(process.cwd(), path), layer, name, body);
      return text(describeEdit({ op: "add", qname: `${layer}.${name}`, opId }));
    },
  );

  tool(
    "kumiki_replace",
    {
      title: "Replace a definition",
      description: "Replace the body of an existing definition. Returns the new op-id.",
      inputSchema: { path: z.string(), name: z.string(), body: z.string() },
    },
    async ({ path, name, body }) => {
      const opId = replaceDef(resolve(process.cwd(), path), name, body);
      return text(describeEdit({ op: "replace", qname: name, opId }));
    },
  );

  tool(
    "kumiki_remove",
    {
      title: "Remove a definition",
      description:
        "Remove a definition. Set cascade=true to also remove definitions that only it referenced. " +
        "Returns the new op-id on a `removed <name>` line, followed by one `cascaded <name>` " +
        "line for each further definition the cascade took.",
      inputSchema: { path: z.string(), name: z.string(), cascade: z.boolean().optional() },
    },
    async ({ path, name, cascade }) => {
      const result = removeDef(resolve(process.cwd(), path), name, cascade ?? false);
      return text(describeEdit({ op: "remove", qname: name, ...result }));
    },
  );

  tool(
    "kumiki_rename",
    {
      title: "Rename a definition",
      description: "Rename a definition and update all references. Returns the new op-id.",
      inputSchema: { path: z.string(), name: z.string(), newName: z.string() },
    },
    async ({ path, name, newName }) => {
      const opId = renameDef(resolve(process.cwd(), path), name, newName);
      return text(describeEdit({ op: "rename", qname: name, newName, opId }));
    },
  );

  tool(
    "kumiki_edit",
    {
      title: "Edit part of a definition",
      description:
        "Apply a partial patch to a definition body (e.g. inside a reducer's do=). Patch shape: {find,replace} for a single textual swap, or {body:<line>: \"replace 'a' -> 'b'\"} for per-line edits. Returns the new op-id.",
      inputSchema: {
        path: z.string(),
        name: z.string().describe("Qualified name, e.g. reducer.addTodo"),
        patch: z
          .union([
            z.object({ find: z.string(), replace: z.string() }),
            z.record(z.string(), z.string()),
          ])
          .describe("Patch object (see description)"),
      },
    },
    async ({ path, name, patch }) => {
      const opId = editDef(resolve(process.cwd(), path), name, patch);
      return text(describeEdit({ op: "edit", qname: name, opId }));
    },
  );

  tool(
    "kumiki_history",
    {
      title: "Show edit history",
      description:
        "Return the op-log entries that touched this definition, in chronological order. Each entry has op-id, op kind, ts, author, parent-ops, depends-on, and (for add/replace) the body or patch.",
      inputSchema: { path: z.string(), name: z.string() },
    },
    async ({ path, name }) => {
      const log = viewHistory(requireSourceFile(path), name);
      if (log.length === 0) return text(`(no history for ${name})`);
      return text(JSON.stringify(log, null, 2));
    },
  );

  tool(
    "kumiki_episode",
    {
      title: "Fetch a runtime episode",
      description:
        "Read one episode (from `<file>.kumiki-episodes.jsonl`) by id. Episodes are written by `kumiki run --episode-log` and `kumiki dev --episode-log` and capture the per-trigger trace described in docs/spec/runtime.md §10.5.1. Prefer `kumiki_episode_list` / `kumiki_episode_tail` to discover ids first.",
      inputSchema: { path: z.string(), episodeId: z.string() },
    },
    async ({ path, episodeId }) => {
      const logPath = episodeLogPathFor(requireSourceFile(path));
      if (!existsSync(logPath)) return text("(no episode log)");
      const { entries } = readEpisodeLog(logPath);
      const hit = entries.find((e) => e.id === episodeId);
      if (hit) return text(JSON.stringify(hit, null, 2));
      throw new Error(`no episode with id ${episodeId}`);
    },
  );

  tool(
    "kumiki_episode_list",
    {
      title: "List recent runtime episodes",
      description:
        "List the most recent episodes in `<file>.kumiki-episodes.jsonl` as compact summaries (`id`, `trigger.kind`, `trigger.target`, `status`, `steps`), newest first. Use this to discover ids for `kumiki_episode` / `kumiki_episode_tail`. When some JSONL lines fail to parse (e.g. runtime logger bug), the response is wrapped as `{ summaries, warnings: [...] }` so the caller sees the drop count.",
      inputSchema: {
        path: z.string(),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum entries to return, newest first. Default 20."),
      },
    },
    async ({ path, limit }) => {
      const logPath = episodeLogPathFor(requireSourceFile(path));
      if (!existsSync(logPath)) return text("(no episode log)");
      const { entries, skipped, firstMalformedLine } = readEpisodeLog(logPath);
      if (entries.length === 0) return text("(empty episode log)");
      const n = limit ?? 20;
      const summaries = entries
        .slice(-n)
        .reverse()
        .map((ep) => ({
          id: ep.id,
          trigger: { kind: ep.trigger?.kind, target: ep.trigger?.target },
          status: ep.status,
          steps: Array.isArray(ep.steps) ? ep.steps.length : 0,
        }));
      if (skipped > 0) {
        return text(
          JSON.stringify(
            { summaries, warnings: buildEpisodeWarnings(skipped, firstMalformedLine) },
            null,
            2,
          ),
        );
      }
      return text(JSON.stringify(summaries, null, 2));
    },
  );

  tool(
    "kumiki_episode_tail",
    {
      title: "Tail the most recent runtime episodes",
      description:
        "Return the most recent N episodes from `<file>.kumiki-episodes.jsonl` as full JSON entries, newest first. Use `kumiki_episode_list` first if you only need summaries. Malformed JSONL lines are surfaced in a `warnings` field when present.",
      inputSchema: {
        path: z.string(),
        n: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Number of episodes to return, newest first. Default 5."),
      },
    },
    async ({ path, n }) => {
      const logPath = episodeLogPathFor(requireSourceFile(path));
      if (!existsSync(logPath)) return text("(no episode log)");
      const { entries, skipped, firstMalformedLine } = readEpisodeLog(logPath);
      if (entries.length === 0) return text("(empty episode log)");
      const take = n ?? 5;
      const episodes = entries.slice(-take).reverse();
      if (skipped > 0) {
        return text(
          JSON.stringify(
            { episodes, warnings: buildEpisodeWarnings(skipped, firstMalformedLine) },
            null,
            2,
          ),
        );
      }
      return text(JSON.stringify(episodes, null, 2));
    },
  );

  tool(
    "kumiki_fix",
    {
      title: "Plan or apply rule-based auto-fixes",
      description:
        'Typecheck a file and either propose auto-patches for repairable errors (e.g. misspelled names) or write them to disk. Default is dry-run (`apply: false`); pass `apply: true` to close the loop and persist the fixes. On apply, returns `{ applied, before, after, remaining }` with the residual diagnostics after re-typechecking. Use `only` (e.g. "E0103") to restrict to a single diagnostic code.',
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
        capabilities: z
          .array(z.string())
          .optional()
          .describe(
            "Project-registered capabilities. Defaults to the nearest kumiki.caps.json at or above the path.",
          ),
      },
    },
    async (input) => {
      const abs = resolve(process.cwd(), input.path);
      const caps = capsForInput(input);
      if (input.apply) {
        const r = applyFixPlan(abs, input.only, caps);
        const body = JSON.stringify(
          {
            applied: r.applied,
            before: r.before,
            after: r.after,
            remaining: toDiagnostics(r.remaining),
            // The advisory half, always — an empty `remaining` means the file
            // is clean of errors, not that it is clean, and an agent deciding
            // whether it is done reads this envelope rather than the CLI's
            // stdout.
            warnings: toDiagnostics(r.warnings),
            // Surface every non-success modifier on the wire so callers
            // can distinguish "no patch was needed" (`applied === 0`,
            // no modifier) from a rollback / parser-break / I/O failure.
            // Without these fields the three failure shapes collapse into
            // one indistinguishable `applied: 0`.
            ...(r.parseError ? { parseError: r.parseError } : {}),
            ...(r.regressionBlocked ? { regressionBlocked: r.regressionBlocked } : {}),
            ...(r.writeError ? { writeError: r.writeError } : {}),
          },
          null,
          2,
        );
        return r.remaining.length > 0 ? failed(body) : text(body);
      }
      const plan = planFix(abs, input.only, caps);
      const advisory = plan.warnings.map((w) => `${w.code} ${w.message}`);
      if (plan.errors.length === 0) {
        // The warnings come out with the verdict. `kumiki_check` on the same
        // file returns a JSON diagnostics array — non-`isError`, since nothing
        // in it is fatal — so an agent told a bare "no errors" here has two
        // answers about one file and nothing that reconciles them. The
        // clean-file verdict is still `text`, not `failed`.
        if (plan.warnings.length === 0) return text("no errors");
        return text([`no errors (${plural(plan.warnings.length)})`, ...advisory].join("\n"));
      }
      // A dry run proposes and repairs nothing, so the file still has every
      // error it started with — which is what `isError` reports here.
      if (plan.patches.length === 0) {
        return failed(
          [
            "(no auto-patches available)",
            ...plan.errors.map((e) => `${e.code} ${e.message}`),
            ...advisory,
          ].join("\n"),
        );
      }
      // The unrepairable half goes out with the repairable half. An agent
      // that reads only the proposals treats the file as one patch away from
      // clean when it is not.
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
        "Repair a .kumiki file from a specific failing `test` definition. Two tiers: (1) if the file has compile errors blocking the test, rule-based fixes (planFixes) are proposed/applied first; (2) if the file compiles but the test fails, a deterministic literal repair is proposed/applied when one is provable. Default is dry-run (`apply: false`). On apply, the outcome ALWAYS includes `regressed` (names of other tests that regressed after the write). Returns a structured `FixFromTestOutcome` — inspect `status` (`already-pass` | `proposed` | `applied` | `compile-proposed` | `compile-blocked` | `compile-remaining` | `no-patch` | `not-found` | `write-failed`). `compile-blocked` means a tier-1 repair was found and the regression gate refused it — the file is unchanged, `compileErrors` is what it still has, and `blocked.reason` says which condition refused it: `introduced` (with the diagnostics it would have added), `resolved-none`, or `parse-error` (with the parser's `message` — a repair rule emitted source that does not parse, which is a compiler-side defect rather than a pointless repair). `write-failed` carries `phase` (`compile` | `test`) and a raw `writeError` message; nothing landed on disk.",
      inputSchema: {
        path: z.string(),
        testName: z.string().describe("The name of the failing `test` definition to fix."),
        apply: z
          .boolean()
          .optional()
          .describe("Write the patch to disk. Default false = propose only."),
        capabilities: z
          .array(z.string())
          .optional()
          .describe(
            "Project-registered capabilities. Defaults to the nearest kumiki.caps.json at or above the path.",
          ),
      },
    },
    async (input) => {
      const abs = resolve(process.cwd(), input.path);
      const caps = capsForInput(input);
      const apply = input.apply === true;
      const outcome = await runFixFromTest(abs, input.testName, apply, caps);
      const body = JSON.stringify(serialiseFixFromTest(outcome), null, 2);
      // `ok` counts a dry-run proposal as success; the named test passing is
      // what was asked for. Same rule as `kumiki fix --auto-patch`.
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
        capabilities: z
          .array(z.string())
          .optional()
          .describe(
            "Project-registered capabilities. Defaults to the nearest kumiki.caps.json at or above the path.",
          ),
      },
    },
    async (input) => {
      const abs = resolve(process.cwd(), input.path);
      const caps = capsForInput(input);
      const report = await runTests(abs, input.filter, caps);
      const body = JSON.stringify(
        {
          total: report.total,
          passed: report.passed,
          failed: report.failed,
          filter: report.filter ?? null,
          results: report.results,
        },
        null,
        2,
      );
      // A filter that matches nothing is a failure for the same reason it is
      // one in `kumiki test`: the caller named tests that are not there.
      const matchedNothing = report.filter !== undefined && report.total === 0;
      return report.failed > 0 || matchedNothing ? failed(body) : text(body);
    },
  );

  tool(
    "kumiki_spec_search",
    {
      title: "Search the spec",
      description:
        "Keyword search across the normative docs/spec documents. Returns doc:line matches.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const hits = searchSpec(query).map((h) => `${h.doc}:${h.line}  ${h.text}`);
      return text(hits.join("\n") || `(no matches for "${query}")`);
    },
  );

  tool(
    "kumiki_spec_list",
    {
      title: "List spec documents",
      description: "List the available normative docs/spec documents.",
      inputSchema: {},
    },
    async () => text(listSpecDocs().join("\n") || "(docs/spec not found)"),
  );

  tool(
    "kumiki_spec_get",
    {
      title: "Get a spec document",
      description: "Fetch the full text of one spec document (e.g. 'language' or 'errors.md').",
      inputSchema: { doc: z.string() },
    },
    async ({ doc }) => {
      const body = getSpecDoc(doc);
      // A name that resolves to no document is a caller mistake, not an empty
      // document: returning the sentence as the answer means a client reads
      // "not found: langauge" as the spec text it asked for.
      if (body === null) throw new Error(`no spec document named "${doc}"`);
      return text(body);
    },
  );

  return server;
}
