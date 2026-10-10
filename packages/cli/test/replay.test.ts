import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReplayEvent } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { formatEvent } from "../src/replay.ts";
import { runCli, SPAWN } from "./helpers/cli.ts";
import { tempDir } from "./helpers/files.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER = resolve(here, "fixtures/replay/counter.kumiki");
const COUNTER_LOG = resolve(here, "fixtures/replay/counter.log.jsonl");
const PERSIST = resolve(here, "fixtures/replay/persist.kumiki");
const PERSIST_LOG = resolve(here, "fixtures/replay/persist.log.jsonl");

const replayCounter = (...args: string[]) =>
  runCli(["replay", COUNTER, "--from-log", COUNTER_LOG, ...args]);

describe("formatEvent panic", () => {
  it("prints category, message, location, indented stack, and cause chain", () => {
    const out = formatEvent({
      kind: "panic",
      episodeId: "ep_0001",
      stepIndex: 0,
      message: "boom",
      location: `reducer "boom"`,
      stack: "Error: boom\n    at boom (src/x.ts:1:1)\n    at outer (src/y.ts:2:2)",
      cause: [{ message: "root", stack: "Error: root\n    at inner (src/z.ts:3:3)" }],
      category: "reducer",
    });
    expect(out?.split("\n")).toEqual([
      `  [panic:reducer] boom  reducer "boom"`,
      "    at boom (src/x.ts:1:1)",
      "    at outer (src/y.ts:2:2)",
      "    Caused by: root",
      "      at inner (src/z.ts:3:3)",
    ]);
  });

  it("falls back to a single line when a log has only `message`", () => {
    const ev: ReplayEvent = { kind: "panic", episodeId: "ep_0001", stepIndex: 0, message: "boom" };
    expect(formatEvent(ev)).toBe("  [panic] boom");
  });

  it("emits the Caused-by header even when a cause link has no stack", () => {
    const out = formatEvent({
      kind: "panic",
      episodeId: "ep_0001",
      stepIndex: 0,
      message: "boom",
      cause: [{ message: "bare" }],
      category: "reducer",
    });
    expect(out).toBe("  [panic:reducer] boom\n    Caused by: bare");
  });
});

describe("formatEvent episode-start", () => {
  it("names the entry reducer whose recorded result is missing", () => {
    const ev: ReplayEvent = {
      kind: "episode-start",
      episodeId: "ep_0001",
      trigger: { kind: "ssr.hydrate", target: "/" },
      entryResultMissing: "load.ok",
    };
    expect(formatEvent(ev)).toBe(
      "episode ep_0001 — ssr.hydrate on /  (no recorded result for load.ok)",
    );
  });

  it("says nothing extra when the log carried it", () => {
    const ev: ReplayEvent = {
      kind: "episode-start",
      episodeId: "ep_0001",
      trigger: { kind: "ssr.hydrate", target: "/" },
    };
    expect(formatEvent(ev)).toBe("episode ep_0001 — ssr.hydrate on /");
  });
});

describe("kumiki replay", () => {
  it("replays a single episode and prints its steps + final slots", SPAWN, () => {
    const { out, code } = replayCounter("ep_0001");
    expect(code).toBe(0);
    expect(out).toContain("episode ep_0001");
    expect(out).toContain("[reducer] inc");
    expect(out).toContain("count: 0 -> 1");
    expect(out).toContain("final slots:");
    expect(out).toMatch(/"count":\s*1/);
    expect(out).toContain("1 episode(s) replayed");
  });

  it("replays every episode of the log in order, carrying the slots across them", SPAWN, () => {
    const { out, code } = replayCounter();
    expect(code).toBe(0);
    const at = ["ep_0001", "ep_0002", "ep_0003"].map((id) => out.indexOf(`episode ${id}`));
    expect(at[0]).toBeGreaterThanOrEqual(0);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(out).toMatch(/"count":\s*3/);
    expect(out).toContain("3 episode(s) replayed");
  });

  it("filters to the <episode-id> it is given", SPAWN, () => {
    const { out, code } = replayCounter("ep_0002");
    expect(code).toBe(0);
    expect(out).toContain("episode ep_0002");
    expect(out).not.toContain("episode ep_0001");
    expect(out).not.toContain("episode ep_0003");
    expect(out).toContain("1 episode(s) replayed");
  });

  it("--until-step N stops replay at step N and reports stop", SPAWN, () => {
    const { out, code } = replayCounter("--until-step", "1");
    expect(code).toBe(0);
    expect(out).toContain("stopped at step 1");
    expect(out).toMatch(/"count":\s*1/);
    expect(out).not.toMatch(/"count":\s*3/);
  });

  it.each([
    {
      mock: ["persist:ok(null)"],
      status: "saved",
      shows: [],
    },
    {
      mock: ['persist: err({"message":"blocked"})'],
      status: "blocked",
      shows: ['[effect-end] persist err = "blocked" (mock:fixed)'],
    },
    { mock: ["persist:from-log"], status: "disk full", shows: [] },
    { mock: ["persist:ignore"], status: "", shows: [] },
    { mock: ["persist:ignore", "noop:from-log"], status: "", shows: [] },
  ])("--mock $mock leaves status $status", SPAWN, ({ mock, status, shows }) => {
    const { out, code } = runCli([
      "replay",
      PERSIST,
      "--from-log",
      PERSIST_LOG,
      ...mock.flatMap((m) => ["--mock", m]),
    ]);
    expect(code).toBe(0);
    for (const line of shows) expect(out).toContain(line);
    const statuses = [...out.matchAll(/"status":\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(statuses.at(-1)).toBe(status);
  });

  it.each([
    [["ep_nope"], 1, /episode ep_nope not found/],
    [["--mock", "garbage"], 2, /invalid --mock/],
    [["ep_0001", "ep_0002"], 2, /unexpected positional/],
    [["--until-step", "0"], 2, /--until-step.*positive integer/s],
  ])("%o exits %i", SPAWN, (args, exit, message) => {
    const { out, code } = replayCounter(...args);
    expect(code).toBe(exit);
    expect(out).toMatch(message);
  });

  it("names an episode whose entry reducer is not in the program, and exits 1", SPAWN, () => {
    const dir = tempDir();
    const program = join(dir, "renamed.kumiki");
    writeFileSync(program, readFileSync(COUNTER, "utf8").replace(/\binc\b/g, "bump"));
    const episode = (id: string, reducer: string): string =>
      JSON.stringify({
        id,
        trigger: { kind: "ui.click", target: "IncBtn" },
        steps: [{ kind: "reducer", name: reducer, "slot-diffs": [], emits: [] }],
        status: "completed",
      });
    const log = join(dir, "renamed.log.jsonl");
    writeFileSync(log, `${episode("ep_inc", "inc")}\n${episode("ep_bump", "bump")}\n`);
    const { out, code } = runCli(["replay", program, "--from-log", log]);
    expect(out).toContain(
      'episode ep_inc — ui.click on IncBtn  (not replayed: no reducer named "inc")',
    );
    expect(out).toContain("[reducer] bump  count: 0 -> 1");
    expect(out).toContain("1 episode(s) replayed");
    expect(out).toContain('not replayed: ep_inc: no reducer named "inc"');
    expect(code).toBe(1);
  });

  it("missing --from-log shows usage and exits 2", SPAWN, () => {
    const { out, code } = runCli(["replay", COUNTER]);
    expect(code).toBe(2);
    expect(out).toMatch(/--from-log/);
  });
});
