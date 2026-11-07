import { readFileSync, writeFileSync } from "node:fs";
import { testFile } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import {
  type AppShape,
  createEpisodeLogger,
  type EpisodeLogEntry,
  replayEpisodes,
  runScenario,
  type Scenario,
} from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { withRoot } from "./helpers/dom.ts";
import { loadApp, writeSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";

const EXAMPLE = feature("283-episode-log-trigger-order");
const SCENARIO = JSON.parse(
  readFileSync(EXAMPLE.replace(/\.kumiki$/, ".scenario.json"), "utf8"),
) as Scenario;

type LiveApp = AppShape & { live: Record<string, unknown> };

/** Run the example's scenario through the live runtime and return its log, through JSON. */
async function record(): Promise<EpisodeLogEntry[]> {
  const app = await loadApp(EXAMPLE);
  const logger = createEpisodeLogger();
  const report = await withRoot((root) =>
    runScenario(app, root, SCENARIO, { episodeLogger: logger }),
  );
  expect(report.ok, failureDetail(report)).toBe(true);
  return JSON.parse(JSON.stringify(logger.list())) as EpisodeLogEntry[];
}

/** Replay `episodes` with `save` answered from the log, as `replay-order` does. */
async function replay(episodes: EpisodeLogEntry[]) {
  const app = (await loadApp(EXAMPLE)) as LiveApp;
  const ran: string[] = [];
  const report = replayEpisodes({
    app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
    episodes,
    mocks: { save: { policy: "from-log" } },
    observer: (ev) => {
      if (ev.kind === "reducer") ran.push(ev.name);
      return "continue";
    },
  });
  return { ran, report };
}

/** A copy of the example whose fixture is `log`. */
function withFixture(log: EpisodeLogEntry[]): string {
  const path = writeSource(
    "episode-log-trigger-order/283-episode-log-trigger-order",
    readFileSync(EXAMPLE, "utf8"),
  );
  const lines = log.map((ep) => `${JSON.stringify(ep)}\n`).join("");
  writeFileSync(path.replace(/\.kumiki$/, ".fixture.jsonl"), lines);
  return path;
}

describe("an episode still waiting on its effect when a later trigger runs", () => {
  it("is logged ahead of that trigger's episode, which was done first", async () => {
    const log = await record();
    expect(log.map((ep) => ep.trigger.target)).toEqual(["ABtn", "BBtn"]);
    // A's save answered after B ran: its `savedOk` read the x that B wrote.
    const savedOk = log[0]?.steps.find((s) => s.kind === "reducer" && s.name === "savedOk");
    expect(savedOk).toMatchObject({ "slot-diffs": [{ name: "saved", before: "", after: "b" }] });
  });

  it("replays A whole, its save answer included, then B, and ends at the run's x", async () => {
    const { ran, report } = await replay(await record());
    expect(report.panics).toEqual([]);
    expect(ran).toEqual(["pickA", "savedOk", "pickB"]);
    expect(report.finalSlots).toEqual({ x: "b", saved: "a" });
  });

  it.each([
    ["the log the scenario records", async () => withFixture(await record())],
    ["the example's committed fixture", async () => EXAMPLE],
  ])("passes `replay-order` over %s", async (_, source) => {
    const path = await source();
    const { ms: _ms, ...result } = defined(
      (await testFile(path)).find((r) => r.name === "replay-order"),
      `replay-order's result for ${path}`,
    );
    expect(result).toEqual({ name: "replay-order", pass: true });
  });
});
