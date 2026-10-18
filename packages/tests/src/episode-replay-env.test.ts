import { readFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import type { EpisodeLogEntry } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { afterValues, recordOne, reducerStep, replayEpisode } from "./helpers/episodes.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("87-replayed-environment-read");
const FIXTURE = EXAMPLE.replace(/\.kumiki$/, ".fixture.jsonl");
const QUALIFIED_NOW = feature("201-qualified-time-now");

const loadOf = (example: string) => () => loadApp(example);

/** Drive one click through the live runtime and return the episode it wrote. */
const recordOneClick = (example = EXAMPLE) =>
  recordOne(loadOf(example), { do: { clickText: "stamp" } });

const replayOnce = async (ep: EpisodeLogEntry, example = EXAMPLE) =>
  (await replayEpisode(loadOf(example), ep)).finalSlots;

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

describe("`Time.now` in a reducer", () => {
  // The example's reducer reads `Time.now`, `Time.now()` and `now`, in that order.
  it("records each spelling as a `now` read", async () => {
    const ep = await recordOneClick(QUALIFIED_NOW);
    const reads = reducerStep(ep)["env-reads"] ?? [];
    expect(reads.map((r) => r.kind)).toEqual(["now", "now", "now"]);
    expect(reads.every((r) => typeof r.value === "number")).toBe(true);
  });

  it("replays the recorded instants into the slots that read them", async () => {
    const ep = await recordOneClick(QUALIFIED_NOW);
    // Instants no live clock answers, so a replay that read the clock instead
    // of the journal cannot land on them.
    const recorded = [1718700000000, 1718700000001, 1718700000002];
    reducerStep(ep)["env-reads"] = recorded.map((value) => ({ kind: "now" as const, value }));
    const slots = await replayOnce(ep, QUALIFIED_NOW);
    expect([slots.stamped, slots.called, slots.bare]).toEqual(recorded);
  });
});
