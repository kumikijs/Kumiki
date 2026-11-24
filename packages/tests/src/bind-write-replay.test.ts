import { testFile } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { replayEpisodes } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { type LiveApp, recordScenario, withFixture } from "./helpers/episodes.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("287-bind-write-replay");

describe("a form filled in through `bind=` and submitted", () => {
  it("logs the typing as an episode of its own, ahead of the submit", async () => {
    const log = await recordScenario(EXAMPLE);
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
      episodes: await recordScenario(EXAMPLE),
      mocks: {},
      observer: () => "continue",
    });
    expect(report.panics).toEqual([]);
    expect(report.entryReducersMissing).toEqual([]);
    expect(report.finalSlots).toEqual({ draft: "", items: ["milk"] });
  });

  it.each([
    [
      "the log the scenario records",
      async () => withFixture(EXAMPLE, await recordScenario(EXAMPLE)),
    ],
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
