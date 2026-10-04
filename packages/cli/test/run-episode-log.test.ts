import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEpisodeLogger } from "@kumikijs/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScenarioSource } from "../src/smoke.ts";
import { CLI_ARGV } from "./helpers/cli.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER = resolve(here, "../../examples/apps/01-counter/app.kumiki");
const EVERY_EPISODE = resolve(
  here,
  "../../examples/features/191-episode-log-keeps-every-episode.kumiki",
);
const EVERY_EPISODE_SCENARIO = EVERY_EPISODE.replace(/\.kumiki$/, ".scenario.json");

// A node + tsx start, a compile and 105 settled clicks per process. The child's
// limit is the shorter one so it fires first: `spawnSync` blocks the worker, so
// vitest's own timeout cannot interrupt a hung CLI.
const CHILD_TIMEOUT_MS = 60_000;
const SPAWN = { timeout: 70_000 };

function runCli(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; code: number } {
  const res = spawnSync(process.execPath, [...CLI_ARGV, ...args], {
    stdio: "pipe",
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
    env: { ...process.env, ...env },
  });
  if (res.error) throw res.error;
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    code: res.status ?? Number.NaN,
  };
}

describe("kumiki run --episode-log", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-episode-log-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("records §10.5.1-shaped episodes for every reducer fired by the scenario", async () => {
    const source = readFileSync(COUNTER, "utf8");
    const logger = createEpisodeLogger();
    await runScenarioSource(
      source,
      {
        steps: [
          { do: { dispatch: "inc" }, expect: { state: { count: 1 } } },
          { do: { dispatch: "inc" }, expect: { state: { count: 2 } } },
          { do: { dispatch: "reset" }, expect: { state: { count: 0 } } },
        ],
      },
      [],
      { episodeLogger: logger },
    );

    const eps = logger.list();
    // The counter has no async effects, so each dispatch yields one episode
    // (the scenario opens 3 — plus an implicit app.start lifecycle if present,
    // counter has init=[] so none here).
    expect(eps.length).toBeGreaterThanOrEqual(3);

    for (const ep of eps) {
      expect(ep.id).toMatch(/^ep_/);
      expect(ep.status).toMatch(/^(completed|panic|ongoing|cancelled)$/);
      expect(ep.trigger.kind).toBeTypeOf("string");
      expect(ep.trigger.ts).toBeTypeOf("number");
      expect(Array.isArray(ep.steps)).toBe(true);
    }

    const incEpisode = eps.find((ep) =>
      ep.steps.some((s) => s.kind === "reducer" && s.name === "inc"),
    );
    expect(incEpisode).toBeDefined();
    const reducerStep = incEpisode!.steps.find((s) => s.kind === "reducer");
    expect(reducerStep).toMatchObject({ kind: "reducer", name: "inc", emits: [] });
    expect(reducerStep).toHaveProperty("slot-diffs");
    const slotDiffs = (reducerStep as { "slot-diffs": Array<{ name: string }> })["slot-diffs"];
    expect(slotDiffs.find((d) => d.name === "count")).toMatchObject({
      name: "count",
      after: 1,
    });
  });

  // §10.5.2: the file is a store of its own, not a copy of the in-memory one,
  // which keeps the most recent 100. Each click of example 191 commits one
  // episode moving `count` by one, so the file's lines, read in order, are the
  // diffs 0 -> 1 … 104 -> 105 — the head of the run included, which is what
  // replay from slot defaults needs.
  describe("a run that commits more episodes than the in-memory store keeps", () => {
    const CLICKS = 105;
    const EVERY_DIFF = Array.from({ length: CLICKS }, (_, i) => ({ before: i, after: i + 1 }));
    let scenario: string;

    beforeAll(() => {
      scenario = join(dir, "clicks.scenario.json");
      const steps: unknown[] = Array.from({ length: CLICKS }, () => ({ do: { click: "#inc" } }));
      steps.push({ expect: { noErrors: true, state: { count: CLICKS } } });
      writeFileSync(scenario, JSON.stringify({ steps }));
    });

    /** The `count` diff of each line's `inc` step, in file order. */
    function countDiffs(logFile: string): unknown[] {
      const lines = readFileSync(logFile, "utf8").split("\n");
      // One JSON object per line, each line terminated.
      expect(lines.pop()).toBe("");
      return lines.map((line) => {
        type Diff = { name: string; before: unknown; after: unknown };
        const ep = JSON.parse(line) as {
          steps: Array<{ kind: string; name?: string; "slot-diffs"?: Diff[] }>;
        };
        const inc = ep.steps.find((s) => s.kind === "reducer" && s.name === "inc");
        const diff = inc?.["slot-diffs"]?.find((d) => d.name === "count");
        return diff === undefined ? line : { before: diff.before, after: diff.after };
      });
    }

    it("writes every committed episode to the --episode-log file", SPAWN, () => {
      const logFile = join(dir, "flag.log.jsonl");
      const r = runCli(["run", EVERY_EPISODE, scenario, "--episode-log", logFile]);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toContain("scenario passed");
      expect(countDiffs(logFile)).toEqual(EVERY_DIFF);
    });

    it("writes the same file when the path comes from KUMIKI_EPISODE_LOG", SPAWN, () => {
      const logFile = join(dir, "env.log.jsonl");
      const r = runCli(["run", EVERY_EPISODE, scenario], { KUMIKI_EPISODE_LOG: logFile });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toContain("scenario passed");
      expect(countDiffs(logFile)).toEqual(EVERY_DIFF);
    });
  });

  // The file is written from the logger's hook, inside the runtime's commit. A
  // path that cannot be written is the CLI's failure, reported once the
  // scenario has been, not an error of the app on whichever step was running.
  it("reports a log file it cannot write after the scenario, not on the app's steps", SPAWN, () => {
    const r = runCli(["run", EVERY_EPISODE, EVERY_EPISODE_SCENARIO, "--episode-log", dir]);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("scenario passed");
    expect(r.stdout).not.toContain("[FAIL]");
    expect(r.stderr).toContain(dir);
  });
});
