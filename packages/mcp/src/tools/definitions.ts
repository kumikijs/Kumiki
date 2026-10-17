import {
  addDef,
  CASCADE_HELP,
  describeEdit,
  describeSkipped,
  editDef,
  findReferences,
  LAYERS,
  listDefs,
  load,
  type OpLogOptions,
  removeDef,
  renameDef,
  replaceDef,
  type SkippedOpLogLine,
  viewDef,
  viewHistory,
  viewWithDeps,
} from "@kumikijs/cli";
import { z } from "zod";
import { absPath, requireSourceFile } from "../input.ts";
import { json, text } from "../wire.ts";
import type { RegisterTool } from "./registrar.ts";

function notFound(name: string): Error {
  return new Error(`Definition "${name}" not found`);
}

const SKIPPED_LINE_NOTE =
  ' When the op log\'s last line is torn and skipped, a second text block follows: `{"warnings": [{"kind": "malformed-jsonl", "message"}]}`, naming the log and the line.';

// A client does not read the server's stderr, so a torn op-log line the read skipped follows the
// answer as a second block. The answer itself is the same either way, so a client reading the op-id
// off the first block reads it whether or not a line was skipped.
function opLogAnswer<T>(run: (options: OpLogOptions) => T, answer: (value: T) => string) {
  const skipped: SkippedOpLogLine[] = [];
  const result = text(answer(run({ onSkipped: (line) => skipped.push(line) })));
  if (skipped.length === 0) return result;
  const warnings = skipped.map((line) => ({
    kind: "malformed-jsonl",
    message: describeSkipped(line),
  }));
  return { content: [...result.content, ...text(json({ warnings })).content] };
}

export function registerDefinitionTools(tool: RegisterTool): void {
  tool(
    "kumiki_list",
    {
      title: "List definitions",
      description: "List the definitions in a .kumiki file, optionally filtered by layer.",
      inputSchema: {
        path: z.string().describe("Path to a .kumiki file"),
        layer: z.enum(LAYERS).optional(),
      },
    },
    async ({ path, layer }) => {
      const entries = listDefs(load(absPath(path)), layer).map(
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
      const store = load(absPath(path));
      const out = withDeps ? viewWithDeps(store, name) : viewDef(store, name);
      if (out === null) throw notFound(name);
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
      const store = load(absPath(path));
      if (!store.byQName.has(name)) throw notFound(name);
      const refs = findReferences(store, name).map((r) => `${r.qname} @ line ${r.line}`);
      return text(refs.join("\n") || "(no references)");
    },
  );

  tool(
    "kumiki_add",
    {
      title: "Add a definition",
      description: `Append a new definition to a .kumiki file. Returns the new op-id.${SKIPPED_LINE_NOTE}`,
      inputSchema: {
        path: z.string(),
        layer: z.enum(LAYERS),
        name: z.string(),
        body: z
          .string()
          .describe(
            "The definition body (without the `<layer> <name>` prefix). A tile's clauses or a type's parameters, if any, go first: `in=Text = heading($1)`, `(T) = {v: T}`",
          ),
      },
    },
    async ({ path, layer, name, body }) =>
      opLogAnswer(
        (options) => addDef(absPath(path), layer, name, body, options),
        (opId) => describeEdit({ op: "add", qname: `${layer}.${name}`, opId }),
      ),
  );

  tool(
    "kumiki_replace",
    {
      title: "Replace a definition",
      description:
        "Replace the body of an existing definition. A body that does not start with a tile's clauses or a type's parameters keeps the ones the definition has; one that starts with `=` drops them. Returns the new op-id, and a `dropped` line for each clause or parameter the definition no longer has." +
        SKIPPED_LINE_NOTE,
      inputSchema: { path: z.string(), name: z.string(), body: z.string() },
    },
    async ({ path, name, body }) =>
      opLogAnswer(
        (options) => replaceDef(absPath(path), name, body, options),
        (result) => describeEdit({ op: "replace", qname: name, ...result }),
      ),
  );

  tool(
    "kumiki_remove",
    {
      title: "Remove a definition",
      description:
        `Remove a definition. Set cascade=true to ${CASCADE_HELP}. ` +
        "Without it, removing a definition that something references is refused. " +
        "Returns the new op-id on a `removed <name>` line, followed by one `cascaded <name>` " +
        "line for each further definition the cascade took." +
        SKIPPED_LINE_NOTE,
      inputSchema: { path: z.string(), name: z.string(), cascade: z.boolean().optional() },
    },
    async ({ path, name, cascade }) =>
      opLogAnswer(
        (options) => removeDef(absPath(path), name, cascade ?? false, options),
        (result) => describeEdit({ op: "remove", qname: name, ...result }),
      ),
  );

  tool(
    "kumiki_rename",
    {
      title: "Rename a definition",
      description: `Rename a definition and update all references. Returns the new op-id.${SKIPPED_LINE_NOTE}`,
      inputSchema: { path: z.string(), name: z.string(), newName: z.string() },
    },
    async ({ path, name, newName }) =>
      opLogAnswer(
        (options) => renameDef(absPath(path), name, newName, options),
        (opId) => describeEdit({ op: "rename", qname: name, newName, opId }),
      ),
  );

  tool(
    "kumiki_edit",
    {
      title: "Edit part of a definition",
      description:
        "Apply a partial patch to a definition body (e.g. inside a reducer's do=). Patch shape: {find,replace} for a single textual swap, or {body:<line>: \"replace 'a' -> 'b'\"} for per-line edits. Returns the new op-id." +
        SKIPPED_LINE_NOTE,
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
    async ({ path, name, patch }) =>
      opLogAnswer(
        (options) => editDef(absPath(path), name, patch, options),
        (opId) => describeEdit({ op: "edit", qname: name, opId }),
      ),
  );

  tool(
    "kumiki_history",
    {
      title: "Show edit history",
      description:
        "Return the op-log entries that touched this definition, in chronological order. Each entry has op-id, op kind, ts, author, parent-ops, depends-on, and (for add/replace) the body or patch." +
        SKIPPED_LINE_NOTE,
      inputSchema: { path: z.string(), name: z.string() },
    },
    async ({ path, name }) =>
      opLogAnswer(
        (options) => viewHistory(requireSourceFile(path), name, options),
        (log) => (log.length === 0 ? `(no history for ${name})` : json(log)),
      ),
  );
}
