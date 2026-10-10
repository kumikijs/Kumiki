import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { createEpisodeLogger, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("101-list-index-write");

describe.each([
  ["a write past the end", "/outside", "write-outside", "Index 3 is out of range"],
  ["a negative write", "/negative", "write-negative", "Index -1 is out of range"],
  ["a read past the end", "/read-outside", "read-outside", "Index 7 is out of range"],
])("%s", (_what, route, reducer, message) => {
  it("is recorded in the episode log as a panic, and its writes roll back", async () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const app: AppShape = await loadApp(EXAMPLE);
    window.history.replaceState(null, "", "/");
    const report = await runScenario(
      app,
      freshRoot(),
      { steps: [{ do: { navigate: route }, expect: { errorIncludes: [`"${reducer}"`] } }] },
      { episodeLogger: logger },
    );
    const ep = logger.list().find((e) => e.status === "panic");
    expect(ep, "no episode ended in a panic").toBeDefined();
    const panicStep = ep?.steps.find((s) => s.kind === "panic");
    expect(JSON.stringify(panicStep)).toContain(message);
    const state = report.steps[0]?.state;
    expect(state?.tries).toBe(0);
    expect(state?.xs).toEqual([1, 2, 3]);
    expect(state?.failed).toContain(message);
  });
});
