import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASCADE_HELP, lockDef } from "@kumikijs/cli";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COUNTER,
  call,
  callBlocks,
  callOnce,
  callTool,
  errorMessage,
  FIX_COUNTER_TESTS,
  listTools,
  useWorkdir,
  withClient,
} from "./helpers/client.ts";

const OP_ID = /\(op_[0-9A-HJKMNP-TV-Z]+\)/;

describe("kumiki_view / kumiki_refs", () => {
  it.each([
    { tool: "kumiki_refs", extra: {} },
    { tool: "kumiki_view", extra: {} },
    { tool: "kumiki_view", extra: { withDeps: true } },
  ])("$tool $extra gives the same error for a name that is not defined", async ({
    tool,
    extra,
  }) => {
    const res = await callOnce(tool, { path: FIX_COUNTER_TESTS, name: "slot.nope", ...extra });
    expect(res.isError).toBe(true);
    expect(errorMessage(res.body)).toBe('Definition "slot.nope" not found');
  });

  it("view with withDeps returns a defined name after its dependencies", async () => {
    const res = await callOnce("kumiki_view", {
      path: FIX_COUNTER_TESTS,
      name: "reducer.inc",
      withDeps: true,
    });
    expect(res.isError).toBe(false);
    expect(res.body).toBe(
      [
        "slot count : Int = 0",
        'tile IncBtn = button(text="+1", onClick=inc)',
        "reducer inc on=ui.click(IncBtn) do= count := count + 1",
      ].join("\n\n"),
    );
  });
});

describe("layer filters", () => {
  it("kumiki_add accepts every layer kumiki_list filters by, including test and motion", async () => {
    const tools = await listTools();
    const layerEnum = (name: string): string[] | undefined =>
      (
        tools.find((t) => t.name === name)?.inputSchema.properties as
          | { layer?: { enum?: string[] } }
          | undefined
      )?.layer?.enum;
    expect(layerEnum("kumiki_list")).toEqual(expect.arrayContaining(["slot", "test", "motion"]));
    expect(layerEnum("kumiki_add")).toEqual(layerEnum("kumiki_list"));
  });
});

describe("what an edit tool reports about the edit it made", () => {
  const workdir = useWorkdir();
  let file: string;
  beforeEach(() => {
    file = join(workdir.path, "counter.kumiki");
    copyFileSync(COUNTER, file);
  });

  const CASCADED = "  cascaded ";
  const cascaded = (out: string): string[] =>
    out
      .split("\n")
      .filter((l) => l.startsWith(CASCADED))
      .map((l) => l.slice(CASCADED.length));

  it("names every definition a cascading remove deleted, the requested one as the headline", async () => {
    const out = (await callOnce("kumiki_remove", { path: file, name: "slot.count", cascade: true }))
      .body;
    expect(out).toContain("removed slot.count");
    expect(cascaded(out)).toEqual([
      "app.Counter",
      "reducer.dec",
      "reducer.inc",
      "reducer.reset",
      "tile.App",
    ]);
    expect(out).toMatch(OP_ID);
  });

  it("describes the cascade as taking the target's dependents", async () => {
    const remove = (await listTools()).find((t) => t.name === "kumiki_remove");
    const description = (remove?.description ?? "").replace(/\s+/g, " ");
    expect(description).toContain(CASCADE_HELP);
    expect(description).toContain("every definition that references it");
  });

  it("says nothing about a cascade when there was none", async () => {
    const out = (await callOnce("kumiki_remove", { path: file, name: "app.Counter" })).body;
    expect(out).toContain("removed app.Counter");
    expect(cascaded(out)).toEqual([]);
    expect(out).toMatch(OP_ID);
  });

  it("carries the op-id out of every edit, and the id is the one the history records", async () => {
    await withClient(async (client) => {
      const edits: Array<[string, Record<string, unknown>, string]> = [
        ["kumiki_add", { layer: "slot", name: "step", body: "Int = 1" }, "added slot.step"],
        ["kumiki_replace", { name: "slot.step", body: "Int = 2" }, "replaced slot.step"],
        ["kumiki_rename", { name: "slot.step", newName: "stride" }, "renamed slot.step -> stride"],
        [
          "kumiki_edit",
          { name: "slot.stride", patch: { find: "2", replace: "3" } },
          "edited slot.stride",
        ],
      ];
      const ids: string[] = [];
      for (const [tool, args, headline] of edits) {
        const out = await callTool(client, tool, { path: file, ...args });
        expect(out).toContain(headline);
        const id = OP_ID.exec(out)?.[0].slice(1, -1);
        expect(id, tool).toBeDefined();
        ids.push(id ?? "");
      }
      const history = await callTool(client, "kumiki_history", { path: file, name: "slot.stride" });
      for (const id of ids) expect(history).toContain(id);
    });
  });

  it("names what a replace dropped from the definition's header", async () => {
    await withClient(async (client) => {
      await callTool(client, "kumiki_add", {
        path: file,
        layer: "type",
        name: "Box",
        body: "(T) = {v: T}",
      });
      const replaced = await callTool(client, "kumiki_replace", {
        path: file,
        name: "type.Box",
        body: "= {v: Int}",
      });
      expect(replaced.split("\n").slice(1)).toEqual(["  dropped parameter T"]);
    });
  });

  it("flags a per-line edit whose text is not on that line, and writes nothing", async () => {
    const source = readFileSync(file, "utf8");
    // `count` is on line 2 of tile.App, not on line 3, which the patch names.
    const res = await callOnce("kumiki_edit", {
      path: file,
      name: "tile.App",
      patch: { "body:3": "replace 'count' -> 'total'" },
    });
    expect(res.isError).toBe(true);
    expect(errorMessage(res.body)).toBe(
      'edit rejected: "count" not present on body line 3 of tile.App',
    );
    expect(readFileSync(file, "utf8")).toBe(source);
    expect(existsSync(`${file}.kumiki-ops.jsonl`)).toBe(false);

    const onTheLine = await callOnce("kumiki_edit", {
      path: file,
      name: "tile.App",
      patch: { "body:2": "replace 'Count: ' -> 'Total: '" },
    });
    expect(onTheLine.isError).toBe(false);
  });
});

describe("ownership locks", () => {
  const workdir = useWorkdir();
  let prevAuthor: string | undefined;
  beforeEach(() => {
    prevAuthor = process.env.KUMIKI_AUTHOR;
  });
  afterEach(() => {
    if (prevAuthor === undefined) delete process.env.KUMIKI_AUTHOR;
    else process.env.KUMIKI_AUTHOR = prevAuthor;
  });

  it("kumiki_replace is refused when its body creates a locked definition", async () => {
    const file = join(workdir.path, "c.kumiki");
    copyFileSync(COUNTER, file);
    lockDef(file, "agent:a", "slot.todos*,reducer.*");
    const source = readFileSync(file, "utf8");
    process.env.KUMIKI_AUTHOR = "agent:b";
    const res = await withClient((client) =>
      call(client, "kumiki_replace", {
        path: file,
        name: "slot.count",
        body: "N = 0\n\nslot todosX : Int = 0",
      }),
    );
    expect(res.isError).toBe(true);
    expect(res.body).toMatch(/lock violation: slot\.todosX is locked by agent:a/);
    expect(readFileSync(file, "utf8")).toBe(source);
    expect(existsSync(`${file}.kumiki-ops.jsonl`)).toBe(false);
  });
});

// A client does not read the server's stderr, so a tool that read a torn last line answers as it
// would without it, then names the line in a second block, as the episode tools report a line they
// could not read.
describe("a tool that reads an op log whose last line is torn", () => {
  const workdir = useWorkdir();
  let file: string;
  let log: string;
  beforeEach(() => {
    file = join(workdir.path, "counter.kumiki");
    log = `${file}.kumiki-ops.jsonl`;
    copyFileSync(COUNTER, file);
  });

  /** The start of an op-log line, cut off mid-key. */
  const TORN = '{"op":"replace","layer":"slot","na';

  /** The second block of an answer from a log whose line `line` was skipped. */
  const skipped = (line: number) => ({
    warnings: [
      {
        kind: "malformed-jsonl",
        message: `${log}:${line}: skipped the last line, which is not valid JSON and has no newline after it; the next op logged replaces it`,
      },
    ],
  });

  /** Log one op, then the start of another cut off. The logged op's id. */
  const seedTorn = async (client: Client): Promise<string> => {
    const out = await callTool(client, "kumiki_replace", {
      path: file,
      name: "slot.count",
      body: "N = 1",
    });
    appendFileSync(log, TORN);
    return /\((op_\w+)\)/.exec(out)?.[1] ?? "(no op-id)";
  };

  it("kumiki_history answers with the complete entries, then the skipped line", async () => {
    await withClient(async (client) => {
      const first = await seedTorn(client);

      const blocks = await callBlocks(client, "kumiki_history", {
        path: file,
        name: "slot.count",
      });

      expect(blocks).toHaveLength(2);
      const [entries = "", warnings = ""] = blocks;
      const ids = (JSON.parse(entries) as Array<{ "op-id": string }>).map((e) => e["op-id"]);
      expect(ids).toEqual([first]);
      expect(JSON.parse(warnings)).toEqual(skipped(2));
    });
  });

  it("kumiki_history of a log that is only the torn line has no history to list", async () => {
    writeFileSync(log, TORN);
    await withClient(async (client) => {
      const blocks = await callBlocks(client, "kumiki_history", {
        path: file,
        name: "slot.count",
      });

      expect(blocks).toHaveLength(2);
      const [answer, warnings = ""] = blocks;
      expect(answer).toBe("(no history for slot.count)");
      expect(JSON.parse(warnings)).toEqual(skipped(1));
    });
  });

  it.each([
    [
      "kumiki_add",
      { layer: "slot", name: "step", body: "Int = 1" },
      /^added slot\.step {2}\(op_\w+\)$/,
    ],
    [
      "kumiki_replace",
      { name: "slot.count", body: "N = 5" },
      /^replaced slot\.count {2}\(op_\w+\)$/,
    ],
    [
      "kumiki_edit",
      { name: "slot.count", patch: { find: "1", replace: "2" } },
      /^edited slot\.count {2}\(op_\w+\)$/,
    ],
    [
      "kumiki_rename",
      { name: "slot.count", newName: "total" },
      /^renamed slot\.count -> total {2}\(op_\w+\)$/,
    ],
    ["kumiki_remove", { name: "app.Counter" }, /^removed app\.Counter {2}\(op_\w+\)$/],
  ])("%s answers with its edit, then the skipped line", async (tool, args, answer) => {
    await withClient(async (client) => {
      await seedTorn(client);

      const blocks = await callBlocks(client, tool, { path: file, ...args });

      expect(blocks).toHaveLength(2);
      const [edit, warnings = ""] = blocks;
      expect(edit).toMatch(answer);
      expect(JSON.parse(warnings)).toEqual(skipped(2));
    });
  });

  it("answers with the answer alone when there is nothing to skip", async () => {
    await withClient(async (client) => {
      // No log yet, then a log of complete entries, then an empty one.
      const first = await callBlocks(client, "kumiki_replace", {
        path: file,
        name: "slot.count",
        body: "N = 1",
      });
      expect(first).toHaveLength(1);
      const history = await callBlocks(client, "kumiki_history", {
        path: file,
        name: "slot.count",
      });
      expect(history).toHaveLength(1);
      expect(JSON.parse(history[0] ?? "")).toHaveLength(1);
      writeFileSync(log, "");
      const added = await callBlocks(client, "kumiki_add", {
        path: file,
        layer: "slot",
        name: "step",
        body: "Int = 1",
      });
      expect(added).toHaveLength(1);
      expect(added[0]).toMatch(/^added slot\.step {2}\(op_\w+\)$/);
    });
  });
});
