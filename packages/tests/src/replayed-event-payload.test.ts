import { readFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import type {
  AppShape,
  EpisodeLogEntry,
  ReplayApp,
  ReplayEvent,
  Scenario,
} from "@kumikijs/runtime";
import {
  _stdlibTest,
  createEpisodeLogger,
  renderToString,
  replayEpisodes,
  runScenario,
} from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("159-replayed-event-payload");
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
    app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
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
    app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
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

describe("the entry reducer's recorded result is consumed", () => {
  function chainApp(): ReplayApp {
    const step = (tag: string) => (live: Record<string, unknown>, p: Record<string, unknown>) => {
      const got = live.got as unknown[];
      return {
        slots: { got: [...got, [tag, p]] },
        emits: got.length === 0 ? [{ effect: "load", args: [] }] : [],
      };
    };
    return {
      live: {},
      slots: { got: { value: [] } },
      effects: {},
      reducers: [
        {
          name: "load.ok",
          event: { kind: "effect", effect: "load", outcome: "ok" },
          apply: step("ok"),
        },
        {
          name: "load.err",
          event: { kind: "effect", effect: "load", outcome: "err" },
          apply: step("err"),
        },
      ],
    };
  }

  type Step = EpisodeLogEntry["steps"][number];
  const end = (result: "ok" | "err", value: unknown): Step => ({
    kind: "effect-end",
    name: "load",
    result,
    value,
  });
  const red = (name: string): Step => ({ kind: "reducer", name, "slot-diffs": [], emits: [] });

  function hydrate(steps: EpisodeLogEntry["steps"]): EpisodeLogEntry {
    return {
      id: "ep_boot",
      trigger: { kind: "ssr.hydrate", target: "/" },
      steps,
      status: "completed",
    };
  }

  function run(ep: EpisodeLogEntry) {
    const app = chainApp();
    const events: ReplayEvent[] = [];
    const report = replayEpisodes({
      app,
      episodes: [ep],
      mocks: { load: { policy: "from-log" } },
      observer: (ev) => {
        events.push(ev);
        return "continue";
      },
    });
    const ends = events.flatMap((ev) =>
      ev.kind === "effect-end" ? [[ev.outcome, ev.value, ev.source]] : [],
    );
    return { report, events, ends, got: report.finalSlots.got };
  }

  it("hands a re-emit of the same effect the result after the consumed one", () => {
    const { ends, got, report } = run(
      hydrate([end("ok", "first"), red("load.ok"), end("ok", "second"), red("load.ok")]),
    );
    expect(report.panics).toEqual([]);
    expect(ends).toEqual([["ok", "second", "from-log"]]);
    expect(got).toEqual([
      ["ok", { $1: "first" }],
      ["ok", { $1: "second", $2: undefined }],
    ]);
  });

  it("hands an `.err` entry reducer the recorded `err` result, not a later `ok` one", () => {
    const { ends, got } = run(hydrate([end("err", "boom"), end("ok", "v"), red("load.err")]));
    expect(got).toEqual([
      ["err", { $1: "boom" }],
      ["ok", { $1: "v", $2: undefined }],
    ]);
    expect(ends).toEqual([["ok", "v", "from-log"]]);
  });

  it("reports an entry result the log does not carry instead of inventing one", () => {
    const { events, got, report } = run(hydrate([red("load.ok")]));
    expect(got).toStrictEqual([["ok", {}]]);
    expect(events[0]).toMatchObject({ kind: "episode-start", entryResultMissing: "load.ok" });
    expect(report.entryResultsMissing).toEqual([{ episodeId: "ep_boot", reducer: "load.ok" }]);
  });

  it("does not report an entry result the log carries", () => {
    const { events, report } = run(hydrate([end("ok", "first"), red("load.ok")]));
    expect(events[0]).not.toHaveProperty("entryResultMissing");
    expect(report.entryResultsMissing).toEqual([]);
  });
});
