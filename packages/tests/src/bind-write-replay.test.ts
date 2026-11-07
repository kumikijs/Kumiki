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

const EXAMPLE = feature("287-bind-write-replay");
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

/** A copy of the example whose fixture is `log`. */
function withFixture(log: EpisodeLogEntry[]): string {
  const path = writeSource(
    "bind-write-replay/287-bind-write-replay",
    readFileSync(EXAMPLE, "utf8"),
  );
  const lines = log.map((ep) => `${JSON.stringify(ep)}\n`).join("");
  writeFileSync(path.replace(/\.kumiki$/, ".fixture.jsonl"), lines);
  return path;
}

describe("a form filled in through `bind=` and submitted", () => {
  it("logs the typing as an episode of its own, ahead of the submit", async () => {
    const log = await record();
    expect(log.map((ep) => [ep.trigger.kind, ep.trigger.target])).toEqual([
      ["ui.input", "draft"],
      ["ui.submit", "AddForm"],
    ]);
    expect(log[0]?.steps).toMatchObject([
      {
        kind: "bind",
        slot: "draft",
        value: "milk",
        "slot-diffs": [{ name: "draft", before: "", after: "milk" }],
      },
    ]);
  });

  it("replays to the slots the run ended at", async () => {
    const app = (await loadApp(EXAMPLE)) as LiveApp;
    const report = replayEpisodes({
      app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
      episodes: await record(),
      mocks: {},
      observer: () => "continue",
    });
    expect(report.panics).toEqual([]);
    expect(report.entryReducersMissing).toEqual([]);
    expect(report.finalSlots).toEqual({ draft: "", items: ["milk"] });
  });

  it.each([
    ["the log the scenario records", async () => withFixture(await record())],
    ["the example's committed fixture", async () => EXAMPLE],
  ])("passes `replay-bug-report` over %s", async (_, source) => {
    const path = await source();
    const { ms: _ms, ...result } = defined(
      (await testFile(path)).find((r) => r.name === "replay-bug-report"),
      `replay-bug-report's result for ${path}`,
    );
    expect(result).toEqual({ name: "replay-bug-report", pass: true });
  });
});
