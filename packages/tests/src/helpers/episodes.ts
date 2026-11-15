import type { AppShape, EpisodeLogEntry, EpisodeStep, ScenarioStep } from "@kumikijs/runtime";
import { createEpisodeLogger, replayEpisodes, runScenario } from "@kumikijs/runtime";
import { expect } from "vitest";
import { withRoot } from "./dom.ts";
import { failureDetail } from "./scenario.ts";

export type ReducerStep = Extract<EpisodeStep, { kind: "reducer" }>;

/** The first reducer step of `ep`. */
export function reducerStep(ep: EpisodeLogEntry): ReducerStep {
  const step = ep.steps.find((s) => s.kind === "reducer");
  if (!step) throw new Error("episode has no reducer step");
  return step as ReducerStep;
}

/** The slot values the recorded reducer produced — what a replay must land on. */
export function afterValues(ep: EpisodeLogEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of reducerStep(ep)["slot-diffs"] ?? []) out[d.name] = d.after;
  return out;
}

/** Drive one scenario step through the live runtime and return the one episode it wrote. */
export async function recordOne(
  load: () => Promise<AppShape>,
  step: ScenarioStep,
): Promise<EpisodeLogEntry> {
  const app = await load();
  const logger = createEpisodeLogger({ memoryMax: 10 });
  const report = await withRoot((root) =>
    runScenario(app, root, { steps: [step] }, { episodeLogger: logger }),
  );
  expect(report.ok, failureDetail(report)).toBe(true);
  const eps = logger.list();
  expect(eps).toHaveLength(1);
  // Through JSON, because that is how an episode reaches `kumiki replay`.
  return JSON.parse(JSON.stringify(eps[0])) as EpisodeLogEntry;
}

/** Replay `ep` against a fresh load of the app, with no mocks. */
export async function replayEpisode(
  load: () => Promise<AppShape>,
  ep: EpisodeLogEntry,
): Promise<ReturnType<typeof replayEpisodes>> {
  const app = (await load()) as AppShape & { live: Record<string, unknown> };
  return replayEpisodes({
    app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
    episodes: [ep],
    mocks: {},
    observer: () => "continue",
  });
}
