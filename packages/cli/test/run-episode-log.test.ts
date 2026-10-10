import { readFileSync } from "node:fs";
import { app } from "@kumikijs/examples";
import { createEpisodeLogger } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { runScenarioSource } from "../src/smoke.ts";

const COUNTER = app("01-counter");

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
});
