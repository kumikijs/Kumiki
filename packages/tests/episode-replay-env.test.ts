// Regression (#337): `kumiki run --episode-log` then `kumiki replay` has to be
// the same run twice, including for a reducer that read the environment. The
// two halves are driven here through the same seams the CLI verbs use — the
// live runtime writes the episode, `replayEpisodes` consumes it — so a break
// anywhere along record → serialize → replay fails this suite rather than
// surfacing as "the dice came up different again".

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape, EpisodeLogEntry, EpisodeStep } from "@kumikijs/runtime";
import { createEpisodeLogger, replayEpisodes, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "87-replayed-environment-read.kumiki");
const FIXTURE = EXAMPLE.replace(/\.kumiki$/, ".fixture.jsonl");

type ReducerStep = Extract<EpisodeStep, { kind: "reducer" }>;

function reducerStep(ep: EpisodeLogEntry): ReducerStep {
  const step = ep.steps.find((s) => s.kind === "reducer");
  if (!step) throw new Error("episode has no reducer step");
  return step as ReducerStep;
}

/** The slot values the recorded reducer produced — what a replay must land on. */
function afterValues(ep: EpisodeLogEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of reducerStep(ep)["slot-diffs"] ?? []) out[d.name] = d.after;
  return out;
}

/** Drive one click through the live runtime and return the episode it wrote. */
async function recordOneClick(): Promise<EpisodeLogEntry> {
  const app = await loadApp(EXAMPLE);
  const logger = createEpisodeLogger({ memoryMax: 10 });
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    const report = await runScenario(
      app,
      root,
      { steps: [{ do: { clickText: "stamp" } }] },
      { episodeLogger: logger },
    );
    expect(report.ok).toBe(true);
    const eps = logger.list();
    expect(eps).toHaveLength(1);
    // Through JSON, because that is how an episode reaches `kumiki replay`.
    return JSON.parse(JSON.stringify(eps[0])) as EpisodeLogEntry;
  } finally {
    root.remove();
  }
}

async function replayOnce(ep: EpisodeLogEntry): Promise<Record<string, unknown>> {
  const app = (await loadApp(EXAMPLE)) as AppShape & { live: Record<string, unknown> };
  return replayEpisodes({
    app: { live: app.live, slots: app.slots, reducers: app.reducers },
    episodes: [ep],
    mocks: {},
    observer: () => "continue",
  }).finalSlots;
}

describe("an episode that read the environment (#337)", () => {
  it("records what `random()` and `now` answered", async () => {
    const ep = await recordOneClick();
    const reads = reducerStep(ep)["env-reads"] ?? [];
    expect(reads.map((r) => r.kind)).toEqual(["random", "now"]);
    const after = afterValues(ep);
    // The recorded diffs are derivable from the recorded reads — which is the
    // property that makes replaying them reproduce the run.
    expect(after.roll).toBe(Math.floor((reads[0]?.value as number) * 6) + 1);
    expect(after.stamped).toBe(String(reads[1]?.value));
  });

  it("replays to the recorded slot-diffs, every time", async () => {
    const ep = await recordOneClick();
    const expected = afterValues(ep);
    for (let i = 0; i < 3; i++) {
      const slots = await replayOnce(ep);
      expect({ roll: slots.roll, stamped: slots.stamped, inRange: slots.inRange }).toEqual(
        expected,
      );
    }
  });

  it("replays the committed fixture to the values the example asserts", async () => {
    const [ep] = readFileSync(FIXTURE, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as EpisodeLogEntry);
    if (!ep) throw new Error(`${FIXTURE} has no episode`);
    const slots = await replayOnce(ep);
    // `(0.5 * 6.0).floor + 1` — the fixture's `random()`, not the replay's.
    expect(slots.roll).toBe(4);
    expect(slots.stamped).toBe("1718700000000");
    expect(slots.inRange).toBe(true);
  });
});
