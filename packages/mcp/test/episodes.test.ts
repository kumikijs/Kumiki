import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callTool, flag, useWorkdir, withClient } from "./helpers/client.ts";

describe("kumiki_episode / kumiki_episode_list / kumiki_episode_tail", () => {
  const workdir = useWorkdir();
  const sourceWithLog = (entries?: string): string => {
    const source = join(workdir.path, "app.kumiki");
    writeFileSync(source, "");
    if (entries !== undefined) writeFileSync(`${source}.kumiki-episodes.jsonl`, entries);
    return source;
  };
  const jsonl = (episodes: object[]): string =>
    `${episodes.map((e) => JSON.stringify(e)).join("\n")}\n`;

  it.each([
    "kumiki_episode_list",
    "kumiki_episode_tail",
  ])("%s returns '(no episode log)' when the sidecar log does not exist", async (tool) => {
    const source = sourceWithLog();
    expect(await withClient((client) => callTool(client, tool, { path: source }))).toBe(
      "(no episode log)",
    );
  });

  it("summarises with kumiki_episode_list, newest first, and honours limit", async () => {
    const source = sourceWithLog(
      jsonl([
        {
          id: "ep_1",
          trigger: { kind: "init", target: "app", ts: 1 },
          steps: [{ kind: "reducer" }],
          status: "completed",
        },
        {
          id: "ep_2",
          trigger: { kind: "ui.click", target: "IncBtn", ts: 2 },
          steps: [{ kind: "reducer" }, { kind: "signal-update" }],
          status: "completed",
        },
        {
          id: "ep_3",
          trigger: { kind: "ui.click", target: "DecBtn", ts: 3 },
          steps: [{ kind: "reducer" }],
          status: "panic",
        },
      ]),
    );
    await withClient(async (client) => {
      const summaries = JSON.parse(
        await callTool(client, "kumiki_episode_list", { path: source }),
      ) as Array<{ id: string; trigger: { kind: string; target: string }; steps: number }>;
      expect(summaries.map((s) => s.id)).toEqual(["ep_3", "ep_2", "ep_1"]);
      expect(summaries[0]?.trigger).toEqual({ kind: "ui.click", target: "DecBtn" });
      expect(summaries[1]?.steps).toBe(2);

      const limited = JSON.parse(
        await callTool(client, "kumiki_episode_list", { path: source, limit: 1 }),
      ) as Array<{ id: string }>;
      expect(limited.map((s) => s.id)).toEqual(["ep_3"]);

      const tail = JSON.parse(
        await callTool(client, "kumiki_episode_tail", { path: source, n: 2 }),
      ) as Array<{ id: string }>;
      expect(tail.map((e) => e.id)).toEqual(["ep_3", "ep_2"]);
    });
  });

  it("surfaces malformed JSONL lines via a warnings field", async () => {
    const ep = (id: string) =>
      JSON.stringify({ id, trigger: { kind: "init" }, steps: [], status: "completed" });
    const source = sourceWithLog(`${ep("ep_a")}\n{ not json\n${ep("ep_b")}\n`);
    await withClient(async (client) => {
      const list = JSON.parse(await callTool(client, "kumiki_episode_list", { path: source })) as {
        summaries: Array<{ id: string }>;
        warnings: Array<{ kind: string; message: string }>;
      };
      expect(list.summaries.map((s) => s.id)).toEqual(["ep_b", "ep_a"]);
      expect(list.warnings).toEqual([
        { kind: "malformed-jsonl", message: "skipped 1 malformed line(s); first at line 2" },
      ]);

      const tail = JSON.parse(await callTool(client, "kumiki_episode_tail", { path: source })) as {
        episodes: Array<{ id: string }>;
        warnings: Array<{ kind: string }>;
      };
      expect(tail.episodes.map((e) => e.id)).toEqual(["ep_b", "ep_a"]);
      expect(tail.warnings[0]?.kind).toBe("malformed-jsonl");
    });
  });

  it("passes through panic stack / cause / category via episode_tail", async () => {
    const panicStep = {
      kind: "panic",
      message: "boom",
      location: `reducer "boom"`,
      stack: "Error: boom\n    at boom (src/x.ts:1:1)",
      cause: [{ message: "root", stack: "Error: root\n    at inner (src/y.ts:2:2)" }],
      category: "reducer",
      ts: 2,
    };
    const source = sourceWithLog(
      jsonl([
        {
          id: "ep_stack",
          trigger: { kind: "ui.click", target: "BoomBtn", ts: 1 },
          steps: [panicStep],
          status: "panic",
        },
      ]),
    );
    const tail = JSON.parse(
      await withClient((client) => callTool(client, "kumiki_episode_tail", { path: source })),
    ) as Array<{ steps: unknown[] }>;
    expect(tail).toHaveLength(1);
    expect(tail[0]?.steps).toEqual([panicStep]);
  });

  it("fetches one episode by id, and flags an id that names nothing", async () => {
    const source = sourceWithLog(jsonl([{ id: "ep_1", status: "completed" }]));
    const hit = await withClient((client) =>
      callTool(client, "kumiki_episode", { path: source, episodeId: "ep_1" }),
    );
    expect(JSON.parse(hit)).toEqual({ id: "ep_1", status: "completed" });
    expect(await flag("kumiki_episode", { path: source, episodeId: "ep_nope" })).toBe(true);
  });
});
