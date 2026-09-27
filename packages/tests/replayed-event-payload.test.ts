// Regression: replaying an episode hands its entry reducer the payload the
// live run handed it (runtime.md §10.5.3). The live runtime records
// `trigger.payload` as the reducer payload itself, and an `ssr.hydrate`
// bootstrap carries its first reducer's value only on the `effect-end` step
// before it. Record → serialize → replay is driven through the same seams the
// CLI verbs use (`kumiki run --episode-log`, `kumiki replay`, `episode-test`).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape, EpisodeLogEntry, ReplayEvent, Scenario } from "@kumikijs/runtime";
import {
  _stdlibTest,
  createEpisodeLogger,
  renderToString,
  replayEpisodes,
  runScenario,
} from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "159-replayed-event-payload.kumiki");
const SCENARIO = JSON.parse(
  readFileSync(EXAMPLE.replace(/\.kumiki$/, ".scenario.json"), "utf8"),
) as Scenario;

type LiveApp = AppShape & { live: Record<string, unknown> };

/** Through JSON, because that is how an episode reaches `kumiki replay`. */
function serialized(eps: readonly EpisodeLogEntry[]): EpisodeLogEntry[] {
  return JSON.parse(JSON.stringify(eps)) as EpisodeLogEntry[];
}

/** Run the example's scenario through the live runtime and return its log. */
async function recordScenario(): Promise<EpisodeLogEntry[]> {
  const app = await loadApp(EXAMPLE);
  const logger = createEpisodeLogger({ memoryMax: 10 });
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    const report = await runScenario(app, root, SCENARIO, { episodeLogger: logger });
    expect(report.ok).toBe(true);
    return serialized(logger.list() as EpisodeLogEntry[]);
  } finally {
    root.remove();
  }
}

async function replay(episodes: EpisodeLogEntry[]) {
  const app = (await loadApp(EXAMPLE)) as LiveApp;
  const events: ReplayEvent[] = [];
  const report = replayEpisodes({
    app: { live: app.live, slots: app.slots, reducers: app.reducers },
    episodes,
    mocks: { fetchQuote: { policy: "from-log" } },
    observer: (ev) => {
      events.push(ev);
      return "continue";
    },
  });
  const diffs = events.flatMap((ev) => (ev.kind === "reducer" ? ev.slotDiffs : []));
  return { report, diffs };
}

async function episodeTest(episodes: EpisodeLogEntry[]) {
  const app = (await loadApp(EXAMPLE)) as LiveApp;
  return _stdlibTest.runEpisodeTest({
    name: "replays-from-log",
    app: { live: app.live, slots: app.slots, reducers: app.reducers },
    episodes,
    mocks: { fetchQuote: { policy: "from-log" } },
    expect: { slotsEqual: "from-log", noPanics: true },
  });
}

describe("a replayed entry reducer gets the payload it ran with", () => {
  it("replays `$el`, `$event` and an effect result's `$1` to what the live run wrote", async () => {
    const eps = await recordScenario();
    // What the live runtime recorded: the payload the reducer ran with.
    expect(eps.map((ep) => [ep.trigger.kind, ep.trigger.payload])).toEqual([
      ["effect.ok", { $1: { text: "hi", author: "me" } }],
      ["ui.click", { $el: { idx: 5 }, $event: { idx: 5 } }],
      ["ui.input", { $el: { value: "hello" }, $event: { value: "hello" } }],
    ]);
    const { report, diffs } = await replay(eps);
    expect(report.panics).toEqual([]);
    expect(diffs).toEqual([
      { name: "quote", before: "none", after: "hi" },
      { name: "n", before: 0, after: 5 },
      { name: "seen", before: "", after: "hello" },
    ]);
    expect(report.finalSlots).toMatchObject({ quote: "hi", n: 5, seen: "hello" });
  });

  it("passes an episode-test asserting `slots-equal: from-log, no-panics: true`", async () => {
    expect(await episodeTest(await recordScenario())).toEqual({
      name: "replays-from-log",
      pass: true,
    });
  });
});

describe("an ssr.hydrate bootstrap episode replays", () => {
  async function bootstrap(): Promise<EpisodeLogEntry> {
    const app = await loadApp(EXAMPLE);
    const rendered = await renderToString(app, {
      providers: {
        "http.get": async () => ({ kind: "ok" as const, value: { text: "hi", author: "me" } }),
      },
    });
    expect(rendered.html).toContain("quote=hi");
    const [ep] = serialized([rendered.bootstrapEpisode as EpisodeLogEntry]);
    if (!ep) throw new Error("renderToString returned no bootstrap episode");
    expect(ep.trigger.kind).toBe("ssr.hydrate");
    expect(ep.trigger.payload).toBeUndefined();
    return ep;
  }

  it("hands its first `.ok` reducer the recorded `effect-end` value as `$1`", async () => {
    const { report, diffs } = await replay([await bootstrap()]);
    expect(report.panics).toEqual([]);
    expect(diffs).toEqual([{ name: "quote", before: "none", after: "hi" }]);
    expect(report.finalSlots.quote).toBe("hi");
  });

  it("passes an episode-test asserting `slots-equal: from-log, no-panics: true`", async () => {
    expect(await episodeTest([await bootstrap()])).toEqual({
      name: "replays-from-log",
      pass: true,
    });
  });
});
