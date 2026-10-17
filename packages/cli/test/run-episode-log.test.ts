import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, feature } from "@kumikijs/examples";
import { createEpisodeLogger } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { runScenarioSource } from "../src/smoke.ts";
import { runCli, SPAWN } from "./helpers/cli.ts";
import { tempDir } from "./helpers/files.ts";

const COUNTER = app("01-counter");
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

    function clicksScenario(dir: string): string {
      const scenario = join(dir, "clicks.scenario.json");
      const steps: unknown[] = Array.from({ length: CLICKS }, () => ({ do: { click: "#inc" } }));
      steps.push({ expect: { noErrors: true, state: { count: CLICKS } } });
      writeFileSync(scenario, JSON.stringify({ steps }));
      return scenario;
    }

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

    it.each([
      ["the --episode-log flag", true],
      ["KUMIKI_EPISODE_LOG", false],
    ])("writes every committed episode to the file named by %s", SPAWN, (_, viaFlag) => {
      const dir = tempDir();
      const scenario = clicksScenario(dir);
      const logFile = join(dir, "run.log.jsonl");
      const r = viaFlag
        ? runCli(["run", EVERY_EPISODE, scenario, "--episode-log", logFile])
        : runCli(["run", EVERY_EPISODE, scenario], { env: { KUMIKI_EPISODE_LOG: logFile } });
      expect(r.code, r.out).toBe(0);
      expect(r.stdout).toContain("scenario passed");
      expect(countDiffs(logFile)).toEqual(EVERY_DIFF);
    });
  });

  // The write happens inside the runtime's commit, where a throw would be
  // reported as an error of the app on whichever step was running.
  it("reports a log file it cannot write after the scenario, not on the app's steps", SPAWN, () => {
    const dir = tempDir();
    const r = runCli(["run", EVERY_EPISODE, EVERY_EPISODE_SCENARIO, "--episode-log", dir]);
    expect(r.code, r.out).toBe(1);
    expect(r.stdout).toContain("scenario passed");
    expect(r.stdout).not.toContain("[FAIL]");
    expect(r.stderr).toContain(dir);
  });
});
