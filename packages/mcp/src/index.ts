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
  editDef,
  episodeLogPathFor,
  findReferences,
  listDefs,
  load,
  planFixes,
  removeDef,
  renameDef,
  replaceDef,
  runScenarioSource,
  smokeSource,
  viewDef,
  viewHistory,
  viewWithDeps,
} from "@kumikijs/cli";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type Scenario = Parameters<typeof runScenarioSource>[1];

import type { KumikiError } from "@kumikijs/compiler";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import {
  CapabilityManifestError,
  nodeRuntimeBundleReader,
  resolveCapabilities,
} from "@kumikijs/compiler/node";
import { z } from "zod";
import { getSpecDoc, listSpecDocs, searchSpec } from "./spec.ts";

type Diagnostic = { code: string; kind: string; message: string; line: number; col: number };

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function readSource(input: { source?: string | undefined; path?: string | undefined }): string {
  if (typeof input.source === "string") return input.source;
  if (input.path) return readFileSync(resolve(process.cwd(), input.path), "utf8");
  throw new Error("provide either `source` or `path`");
}

/**
 * Registered capabilities for an input: from the `kumiki.caps.json` next to a
 * `path`, or an explicit `capabilities` list when only `source` is given.
 */
function capsForInput(input: {
  path?: string | undefined;
  capabilities?: string[] | undefined;
}): string[] {
  if (input.path) return resolveCapabilities(resolve(process.cwd(), input.path));
  return input.capabilities ?? [];
}

/** Turn a thrown input error (bad path / malformed manifest) into a clean message. */
function errMsg(e: unknown): string {
  if (e instanceof CapabilityManifestError) return `capability manifest error: ${e.message}`;
  return `error: ${e instanceof Error ? e.message : String(e)}`;
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

/** Parse + typecheck, normalizing parse exceptions into a single diagnostic. */
function validate(
  source: string,
  capabilities: string[] = [],
): { ok: boolean; diagnostics: Diagnostic[] } {
  try {
    const program = parse(lex(source));
    const errors = check(program, { capabilities });
    return { ok: errors.length === 0, diagnostics: toDiagnostics(errors) };
  } catch (e) {
    const pe = e as { message?: string; pos?: { line: number; col: number } };
    return {
      ok: false,
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

  server.registerTool(
    "kumiki_check",
    {
      title: "Check Kumiki source",
      description:
        "Parse and typecheck a Kumiki program. Pass `source` (text) or `path` (file). Returns ok or a list of diagnostics with codes (see docs/spec/errors.md).",
      inputSchema: {
        source: z.string().optional().describe("Full Kumiki source text"),
        path: z.string().optional().describe("Path to a .kumiki file (relative to cwd)"),
        capabilities: z
          .array(z.string())
          .optional()
          .describe(
            "Project-registered capabilities accepted in app.caps (when passing `source`). With `path`, a co-located kumiki.caps.json is read automatically.",
          ),
      },
    },
    async (input) => {
      try {
        const result = validate(readSource(input), capsForInput(input));
        if (result.ok) return text("ok — no diagnostics");
        return text(JSON.stringify(result.diagnostics, null, 2));
      } catch (e) {
        return text(errMsg(e));
      }
    },
  );

  server.registerTool(
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
            "Project-registered capabilities accepted in app.caps (when passing `source`). With `path`, a co-located kumiki.caps.json is read automatically.",
          ),
      },
    },
    async (input) => {
      try {
        const source = readSource(input);
        const result = compile(source, {
          runtimeSpecifier: "./runtime.js",
          bundle: true,
          readRuntimeBundle: nodeRuntimeBundleReader,
          capabilities: capsForInput(input),
        });
        if (result.kind === "fail") {
          return text(`build failed:\n${JSON.stringify(toDiagnostics(result.errors), null, 2)}`);
        }
        if (input.includeJs) return text(result.js);
        return text(
          `build ok — ${result.js.length} bytes of JS (pass includeJs=true for the source)`,
        );
      } catch (e) {
        return text(errMsg(e));
      }
    },
  );

  server.registerTool(
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
            "Project-registered capabilities (when passing `source`). With `path`, a co-located kumiki.caps.json is read automatically.",
          ),
      },
    },
    async (input) => {
      try {
        const report = await smokeSource(readSource(input), capsForInput(input));
        if (report.ok) {
          return text(
            `ok — mounted, rendered, ${report.interactions} interaction(s), no runtime errors`,
          );
        }
        const lines = report.issues.map(
          (i) => `[${i.phase}] ${i.message}${i.trigger ? ` (on ${i.trigger})` : ""}`,
        );
        return text(
          `runtime smoke failed (mounted=${report.mounted}, rendered=${report.rendered}):\n${lines.join("\n")}`,
        );
      } catch (e) {
        return text(errMsg(e));
      }
    },
  );

  server.registerTool(
    "kumiki_run_scenario",
    {
      title: "Run a scenario",
      description:
        "Drive a Kumiki app through a scenario and return a per-step trace (slot state, DOM text, errors, emitted effects) plus assertion results. This is the substrate for an autonomous generate→run→observe→fix loop: write the user's requirements as scenario steps with `expect` assertions on state, run, read the trace, and patch without a human operating the app.\n\nScenario shape: { steps: [{ label?, do?, expect? }], effects?: { <name>: [{outcome, value}] } }. An action `do` is one of: {dispatch, payload?}, {clickText}, {click}, {fill, value}, {choose, value}, {navigate}. An `expect` is { noErrors?, state?: {slot: value}, domIncludes?: [..], domExcludes?: [..] } (state uses partial match; keys may be dotted paths).",
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
            "Project-registered capabilities (when passing `source`). With `path`, a co-located kumiki.caps.json is read automatically.",
          ),
      },
    },
    async (input) => {
      let report: Awaited<ReturnType<typeof runScenarioSource>>;
      try {
        report = await runScenarioSource(
          readSource(input),
          input.scenario as unknown as Scenario,
          capsForInput(input),
        );
      } catch (e) {
        return text(errMsg(e));
      }
      const lines = report.steps.map((s, i) => {
        const status = s.errors.length === 0 && s.failures.length === 0 ? "ok" : "FAIL";
        const head = `step ${i}${s.label ? ` (${s.label})` : ""}${s.action ? `: ${s.action}` : ""}`;
        const sub = [
          ...s.errors.map((e) => `    error: ${e}`),
          ...s.failures.map((f) => `    assert: ${f}`),
        ];
        const emits = s.emits.length ? `    emits: ${s.emits.map((e) => e.effect).join(", ")}` : "";
        return [`[${status}] ${head}`, ...sub, emits].filter(Boolean).join("\n");
      });
      const tail = report.ok ? "scenario passed" : "scenario FAILED";
      // Include the final state snapshot to help the agent diagnose.
      const finalState = report.steps.at(-1)?.state ?? {};
      return text(`${lines.join("\n")}\n\n${tail}\nfinal state: ${JSON.stringify(finalState)}`);
    },
  );

  server.registerTool(
    "kumiki_list",
    {
      title: "List definitions",
      description: "List the definitions in a .kumiki file, optionally filtered by layer.",
      inputSchema: {
        path: z.string().describe("Path to a .kumiki file"),
        layer: z
          .enum(["type", "slot", "effect", "reducer", "tile", "fn", "app", "theme"])
          .optional(),
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

  server.registerTool(
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
      return text(out ?? `not found: ${name}`);
    },
  );

  server.registerTool(
    "kumiki_refs",
    {
      title: "Find references",
      description: "Find all sites that reference a definition.",
      inputSchema: { path: z.string(), name: z.string() },
    },
    async ({ path, name }) => {
      const store = load(resolve(process.cwd(), path));
      const refs = findReferences(store, name).map((r) => `${r.qname} @ line ${r.line}`);
      return text(refs.join("\n") || "(no references)");
    },
  );

  server.registerTool(
    "kumiki_add",
    {
      title: "Add a definition",
      description: "Append a new definition to a .kumiki file.",
      inputSchema: {
        path: z.string(),
        layer: z.enum(["type", "slot", "effect", "reducer", "tile", "fn", "app", "theme"]),
        name: z.string(),
        body: z.string().describe("The definition body (without the `<layer> <name>` prefix)"),
      },
    },
    async ({ path, layer, name, body }) => {
      addDef(resolve(process.cwd(), path), layer, name, body);
      return text(`added ${layer}.${name}`);
    },
  );

  server.registerTool(
    "kumiki_replace",
    {
      title: "Replace a definition",
      description: "Replace the body of an existing definition.",
      inputSchema: { path: z.string(), name: z.string(), body: z.string() },
    },
    async ({ path, name, body }) => {
      replaceDef(resolve(process.cwd(), path), name, body);
      return text(`replaced ${name}`);
    },
  );

  server.registerTool(
    "kumiki_remove",
    {
      title: "Remove a definition",
      description:
        "Remove a definition. Set cascade=true to also remove definitions that only it referenced.",
      inputSchema: { path: z.string(), name: z.string(), cascade: z.boolean().optional() },
    },
    async ({ path, name, cascade }) => {
      removeDef(resolve(process.cwd(), path), name, cascade ?? false);
      return text(`removed ${name}`);
    },
  );

  server.registerTool(
    "kumiki_rename",
    {
      title: "Rename a definition",
      description: "Rename a definition and update all references.",
      inputSchema: { path: z.string(), name: z.string(), newName: z.string() },
    },
    async ({ path, name, newName }) => {
      renameDef(resolve(process.cwd(), path), name, newName);
      return text(`renamed ${name} -> ${newName}`);
    },
  );

  server.registerTool(
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
      return text(`edited ${name}  (${opId})`);
    },
  );

  server.registerTool(
    "kumiki_history",
    {
      title: "Show edit history",
      description:
        "Return the op-log entries that touched this definition, in chronological order. Each entry has op-id, op kind, ts, author, parent-ops, depends-on, and (for add/replace) the body or patch.",
      inputSchema: { path: z.string(), name: z.string() },
    },
    async ({ path, name }) => {
      const log = viewHistory(resolve(process.cwd(), path), name);
      if (log.length === 0) return text(`(no history for ${name})`);
      return text(JSON.stringify(log, null, 2));
    },
  );

  server.registerTool(
    "kumiki_episode",
    {
      title: "Fetch a runtime episode",
      description:
        "Read one episode (from `<file>.kumiki-episodes.jsonl`) by id. Episodes are written by `kumiki run` and capture the per-trigger trace described in docs/spec/runtime.md §10.5.1.",
      inputSchema: { path: z.string(), episodeId: z.string() },
    },
    async ({ path, episodeId }) => {
      const logPath = episodeLogPathFor(resolve(process.cwd(), path));
      if (!existsSync(logPath)) return text("(no episode log)");
      const lines = readFileSync(logPath, "utf8").split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as { id?: string };
        if (entry.id === episodeId) return text(JSON.stringify(entry, null, 2));
      }
      return text(`(no episode with id ${episodeId})`);
    },
  );

  server.registerTool(
    "kumiki_fix",
    {
      title: "Plan auto-fixes",
      description:
        "Typecheck a file and propose auto-patches for repairable errors (e.g. misspelled names). Returns the planned fixes; this tool does not write to disk.",
      inputSchema: { path: z.string() },
    },
    async ({ path }) => {
      const abs = resolve(process.cwd(), path);
      const store = load(abs);
      const errors = check(store.program);
      const patches = planFixes(store, errors).map((p) => `${p.code}: ${p.description}`);
      return text(patches.join("\n") || "(no auto-fixable diagnostics)");
    },
  );

  server.registerTool(
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

  server.registerTool(
    "kumiki_spec_list",
    {
      title: "List spec documents",
      description: "List the available normative docs/spec documents.",
      inputSchema: {},
    },
    async () => text(listSpecDocs().join("\n") || "(docs/spec not found)"),
  );

  server.registerTool(
    "kumiki_spec_get",
    {
      title: "Get a spec document",
      description: "Fetch the full text of one spec document (e.g. 'language' or 'errors.md').",
      inputSchema: { doc: z.string() },
    },
    async ({ doc }) => text(getSpecDoc(doc) ?? `not found: ${doc}`),
  );

  return server;
}
