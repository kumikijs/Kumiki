import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, feature } from "@kumikijs/examples";
import { createEpisodeLogger, type EpisodeLogger } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { fileEpisodeLogger, runScenarioSource } from "../src/smoke.ts";
import { runCli, SPAWN } from "./helpers/cli.ts";
import { tempDir } from "./helpers/files.ts";

const COUNTER = app("01-counter");
const RETRY = app("08-http-retry");
const EVERY_EPISODE = feature("191-episode-log-keeps-every-episode");
const EVERY_EPISODE_SCENARIO = EVERY_EPISODE.replace(/\.kumiki$/, ".scenario.json");

describe("kumiki run --episode-log", () => {
  it("records an episode for every reducer the scenario fires", async () => {
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

  // The in-memory store keeps the most recent 100; replay from slot defaults
  // needs the head of the run, so the file has to hold all 105.
  describe("a run that commits more episodes than the in-memory store keeps", () => {
    const CLICKS = 105;
    const EVERY_DIFF = Array.from({ length: CLICKS }, (_, i) => ({ before: i, after: i + 1 }));

    function countDiffs(logFile: string): unknown[] {
      const lines = readFileSync(logFile, "utf8").split("\n");
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

    it("clicks past what the in-memory store keeps", () => {
      const capped = createEpisodeLogger();
      for (let i = 0; i < CLICKS; i++) {
        capped.beginTrigger({ kind: "ui.click" });
        capped.endTrigger();
      }
      expect(capped.list().length).toBeLessThan(CLICKS);
    });

    it.each([
      ["the --episode-log flag", true],
      ["KUMIKI_EPISODE_LOG", false],
    ])("writes every committed episode to the file named by %s", SPAWN, (_, viaFlag) => {
      const logFile = join(tempDir(), "run.log.jsonl");
      const r = viaFlag
        ? runCli(["run", EVERY_EPISODE, EVERY_EPISODE_SCENARIO, "--episode-log", logFile])
        : runCli(["run", EVERY_EPISODE, EVERY_EPISODE_SCENARIO], {
            env: { KUMIKI_EPISODE_LOG: logFile },
          });
      expect(r.code, r.out).toBe(0);
      expect(r.stdout).toContain("scenario passed");
      expect(countDiffs(logFile)).toEqual(EVERY_DIFF);
      const replayed = runCli(["replay", EVERY_EPISODE, "--from-log", logFile]);
      expect(replayed.code, replayed.out).toBe(0);
      expect(replayed.stdout).toContain(`final slots: {"count":${CLICKS}}`);
    });
  });

  // The request is still waiting in its retry backoff when the scenario ends; it finishes
  // after the app is disposed, and only then does the click's episode commit.
  it("writes no episode that commits after the run has returned", SPAWN, () => {
    const full = JSON.parse(readFileSync(join(dirname(RETRY), "scenario.json"), "utf8")) as {
      steps: Array<{ do?: unknown }>;
    };
    expect(full.steps.at(-1)?.do).toEqual({ wait: 1500 });
    const dir = tempDir();
    const scenario = join(dir, "no-wait.scenario.json");
    writeFileSync(scenario, JSON.stringify({ ...full, steps: full.steps.slice(0, -1) }));
    const logFile = join(dir, "run.log.jsonl");
    const r = runCli(["run", RETRY, scenario, "--episode-log", logFile]);
    expect(r.code, r.out).toBe(0);
    expect(readFileSync(logFile, "utf8")).toBe("");
  });

  // A directory fails at open on Linux, before the scenario runs. On Windows the open
  // succeeds and the first episode's write fails; either way no step reports it.
  it("fails the run on a log file it cannot write, naming it, on no step of the app", SPAWN, () => {
    const dir = tempDir();
    const r = runCli(["run", EVERY_EPISODE, EVERY_EPISODE_SCENARIO, "--episode-log", dir]);
    expect(r.code, r.out).toBe(1);
    expect(r.stdout).not.toContain("[FAIL]");
    expect(r.stderr).toContain(`could not write episode log ${dir}`);
  });

  it("creates the file for a run that commits no episode", SPAWN, () => {
    const dir = tempDir();
    const scenario = join(dir, "idle.scenario.json");
    writeFileSync(scenario, JSON.stringify({ steps: [{ expect: { noErrors: true } }] }));
    const logFile = join(dir, "run.log.jsonl");
    const r = runCli(["run", EVERY_EPISODE, scenario, "--episode-log", logFile]);
    expect(r.code, r.out).toBe(0);
    expect(readFileSync(logFile, "utf8")).toBe("");

    const missing = join(dir, "no-such-dir", "run.log.jsonl");
    const refused = runCli(["run", EVERY_EPISODE, scenario, "--episode-log", missing]);
    expect(refused.code, refused.out).toBe(1);
    expect(refused.stderr).toContain(`could not write episode log ${missing}`);
  });
});

describe("fileEpisodeLogger", () => {
  function commit(logger: EpisodeLogger): void {
    logger.beginTrigger({ kind: "ui.click" });
    logger.endTrigger();
  }

  it("appends nothing after a write fails, so the file has no gap", () => {
    const parent = join(tempDir(), "not-yet");
    const path = join(parent, "run.log.jsonl");
    const log = fileEpisodeLogger(path);
    commit(log.logger);
    mkdirSync(parent);
    commit(log.logger);
    expect(existsSync(path)).toBe(false);
    const failure = log.close();
    expect(failure?.message).toContain(`could not write episode log ${path}: `);
    expect(failure?.message).toContain("ENOENT");
  });

  it("writes nothing that commits after it is closed", () => {
    const path = join(tempDir(), "run.log.jsonl");
    const log = fileEpisodeLogger(path);
    commit(log.logger);
    expect(log.close()).toBeNull();
    commit(log.logger);
    expect(readFileSync(path, "utf8").split("\n")).toHaveLength(2);
  });
});
