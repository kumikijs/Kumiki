// An index that names no element of a List is a panic (lifecycle.md §7.2.2,
// language.md §1.6.3), on both sides of `:=`. The corpus example
// (`101-list-index-write`) pins the rollback and `app.error` through its
// scenario; what a scenario run cannot show is the episode log, because
// `kumiki run` attaches no logger. This suite attaches one and drives the
// example through the same routes its scenario does.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape } from "@kumikijs/runtime";
import { createEpisodeLogger, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "101-list-index-write.kumiki");

function freshRoot(): HTMLElement {
  // The cases navigate, and the next mount would otherwise start on the route
  // the last one left — firing that route's panic on the way in.
  window.history.replaceState(null, "", "/");
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

describe.each([
  ["a write past the end", "/outside", "write-outside", "Index 3 is out of range"],
  ["a negative write", "/negative", "write-negative", "Index -1 is out of range"],
  ["a read past the end", "/read-outside", "read-outside", "Index 7 is out of range"],
])("%s", (_what, route, reducer, message) => {
  it("is recorded in the episode log as a panic, and its writes roll back", async () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const app: AppShape = await loadApp(EXAMPLE);
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
