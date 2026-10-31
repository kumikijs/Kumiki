import { readFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import type { Scenario } from "@kumikijs/runtime";
import { createEpisodeLogger, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { reducerStep } from "./helpers/episodes.ts";
import { loadApp } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";

// Its scenario cancels the search's handle after the response has arrived.
const EXAMPLE = feature("209-effect-id-opaque");
const SCENARIO = JSON.parse(
  readFileSync(EXAMPLE.replace(/\.kumiki$/, ".scenario.json"), "utf8"),
) as Scenario;

describe("an http.cancel of a request that has completed, in compiled code", () => {
  it("records no effect-cancel step: the cancel reducer's step is all that says it was emitted", async () => {
    const app = await loadApp(EXAMPLE);
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const report = await withRoot((root) =>
      runScenario(app, root, SCENARIO, { episodeLogger: logger }),
    );
    expect(report.ok, failureDetail(report)).toBe(true);
    const eps = logger.list();
    const cancelled = eps.filter((ep) =>
      ep.steps.some((s) => s.kind === "reducer" && s.name === "cancel"),
    );
    expect(cancelled.map((ep) => reducerStep(ep).emits)).toEqual([["cancelSearch"]]);
    expect(eps.flatMap((ep) => ep.steps).filter((s) => s.kind === "effect-cancel")).toEqual([]);
  });
});
