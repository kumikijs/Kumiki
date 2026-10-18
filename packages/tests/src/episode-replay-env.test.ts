import { readFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import type { EpisodeLogEntry } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { afterValues, recordOne, reducerStep, replayEpisode } from "./helpers/episodes.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("87-replayed-environment-read");
const FIXTURE = EXAMPLE.replace(/\.kumiki$/, ".fixture.jsonl");

const load = () => loadApp(EXAMPLE);

/** Drive one click through the live runtime and return the episode it wrote. */
const recordOneClick = () => recordOne(load, { do: { clickText: "stamp" } });

const replayOnce = async (ep: EpisodeLogEntry) => (await replayEpisode(load, ep)).finalSlots;

describe("an episode that read the environment", () => {
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
