import type { EpisodeLogEntry, ReplayEvent } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { replayableApp, replayInto } from "./helpers/episode-apps.ts";

describe("replayEpisodes panic emit", () => {
  const panicEpisode: EpisodeLogEntry = {
    id: "ep_panic",
    trigger: { kind: "ui.click", target: "BoomBtn", ts: 1 },
    steps: [{ kind: "reducer", name: "boom", "slot-diffs": [], emits: [], ts: 2 }],
    status: "panic",
  };

  it("emits a panic event enriched with stack, cause chain, category, and location", () => {
    const app = replayableApp({
      slots: { count: { value: 0 } },
      reducers: [
        {
          name: "boom",
          event: { kind: "ui", ev: "click" },
          apply: () => {
            throw new Error("boom in replay", { cause: new Error("root disk") });
          },
        },
      ],
    });
    const events: ReplayEvent[] = [];
    const report = replayInto(app, [panicEpisode], (ev) => {
      events.push(ev);
      return "continue";
    });

    const panic = events.find((e) => e.kind === "panic");
    if (panic?.kind !== "panic") throw new Error("no panic event was emitted");
    expect(panic.message).toBe("boom in replay");
    expect(panic.category).toBe("reducer");
    // A throw that carried no location is attributed to the reducer that threw it.
    expect(panic.location).toBe(`reducer "boom"`);
    expect(panic.stack).toMatch(/at .+/);
    expect(panic.cause?.[0]?.message).toBe("root disk");

    expect(report.panics).toHaveLength(1);
    expect(report.panics[0]!.stack).toMatch(/at .+/);
    expect(report.panics[0]!.category).toBe("reducer");
  });
});
