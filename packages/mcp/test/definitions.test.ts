import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CASCADE_HELP, lockDef } from "@kumikijs/cli";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COUNTER,
  call,
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
