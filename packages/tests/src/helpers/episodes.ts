import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import type {
  AppShape,
  EpisodeLogEntry,
  EpisodeLogger,
  EpisodeStep,
  Scenario,
  ScenarioStep,
} from "@kumikijs/runtime";
import { createEpisodeLogger, replayEpisodes, runScenario } from "@kumikijs/runtime";
import { expect } from "vitest";
import { withRoot } from "./dom.ts";
import { loadApp, writeSource } from "./load.ts";
import { failureDetail } from "./scenario.ts";

export type ReducerStep = Extract<EpisodeStep, { kind: "reducer" }>;

/** An app as a load hands it back, with its `live` map, which replay reads and writes. */
export type LiveApp = AppShape & { live: Record<string, unknown> };

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
  const app = (await load()) as LiveApp;
  return replayEpisodes({
    app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
    episodes: [ep],
    mocks: {},
    observer: () => "continue",
  });
}

/**
 * Run the `.scenario.json` beside `example` through the live runtime, check it passed, and return
 * the log it recorded, through JSON.
 */
export async function recordScenario(example: string): Promise<EpisodeLogEntry[]> {
  const scenario = JSON.parse(
    readFileSync(example.replace(/\.kumiki$/, ".scenario.json"), "utf8"),
  ) as Scenario;
  const app = await loadApp(example);
  const logger = createEpisodeLogger();
  const report = await withRoot((root) =>
    runScenario(app, root, scenario, { episodeLogger: logger }),
  );
  expect(report.ok, failureDetail(report)).toBe(true);
  return JSON.parse(JSON.stringify(logger.list())) as EpisodeLogEntry[];
}

/** A copy of `example` whose fixture is `log`, for the `episode-test`s that read one. */
export function withFixture(example: string, log: EpisodeLogEntry[]): string {
  const name = basename(example, ".kumiki");
  const path = writeSource(`${name}/${name}`, readFileSync(example, "utf8"));
  const lines = log.map((ep) => `${JSON.stringify(ep)}\n`).join("");
  writeFileSync(path.replace(/\.kumiki$/, ".fixture.jsonl"), lines);
  return path;
}

/** What {@link throwingLogger} throws, as a host's episode sink that went offline would. */
export const SINK_DOWN = "episode sink offline";

/**
 * An episode logger whose `method` does its work and then throws {@link SINK_DOWN}, each time
 * `when` holds for what it was handed.
 */
export function throwingLogger<M extends keyof EpisodeLogger>(
  method: M,
  when: (...args: Parameters<EpisodeLogger[M]>) => boolean,
): EpisodeLogger {
  const logger = createEpisodeLogger();
  const work = logger[method] as (...args: Parameters<EpisodeLogger[M]>) => unknown;
  const throwing = (...args: Parameters<EpisodeLogger[M]>): unknown => {
    const out = work(...args);
    if (when(...args)) throw new Error(SINK_DOWN);
    return out;
  };
  return { ...logger, [method]: throwing };
}
