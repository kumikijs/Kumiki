import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { call, useWorkdir, withClient } from "./helpers/client.ts";

/** A value for every required argument of a tool other than `path`. */
const ARGS: Record<string, Record<string, unknown>> = {
  kumiki_add: { layer: "slot", name: "x", body: ": Int = 0" },
  kumiki_replace: { name: "slot.x", body: ": Int = 1" },
  kumiki_remove: { name: "slot.x" },
  kumiki_rename: { name: "slot.x", newName: "y" },
  kumiki_edit: { name: "slot.x", patch: { find: "0", replace: "1" } },
  kumiki_view: { name: "slot.x" },
  kumiki_refs: { name: "slot.x" },
  kumiki_history: { name: "slot.x" },
  kumiki_auto_patch: { testName: "t" },
  kumiki_run_scenario: { scenario: { steps: [] } },
  kumiki_episode: { episodeId: "ep_0001" },
};

describe("failure reporting", () => {
  const workdir = useWorkdir();

  it("every tool that opens a file reports a missing one in the JSON error envelope", async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const withPath = tools.filter(
        (t) =>
          (t.inputSchema.properties as Record<string, unknown> | undefined)?.path !== undefined,
      );
      expect(withPath.map((t) => t.name)).toEqual(
        expect.arrayContaining(["kumiki_check", "kumiki_fix", "kumiki_auto_patch"]),
      );
      expect(withPath.length).toBeGreaterThan(14);
      for (const t of withPath) {
        const res = await call(client, t.name, {
          path: join(workdir.path, "does-not-exist.kumiki"),
          ...(ARGS[t.name] ?? {}),
        });
        expect(res.isError, `${t.name} reported a missing file as success`).toBe(true);
        const parsed = JSON.parse(res.body) as { error?: { kind: string; message: string } };
        expect(parsed.error?.kind, `${t.name} used a different envelope`).toBe("error");
        expect(typeof parsed.error?.message).toBe("string");
      }
    });
  });
});
