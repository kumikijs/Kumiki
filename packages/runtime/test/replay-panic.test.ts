import type { AppShape, EpisodeLogEntry, ReplayEvent } from "@kumikijs/runtime";
import { replayEpisodes } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

describe("replayEpisodes panic emit", () => {
  function makePanicApp(): AppShape {
    const app: AppShape = {
      slots: { count: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "boom",
          event: { kind: "ui", ev: "click" },
          apply: () => {
            const rootCause = new Error("root disk");
            throw new Error("boom in replay", { cause: rootCause });
          },
        },
      ],
      root: () => ({ kind: "text", text: "" }),
    };
    app.live = { count: 0 };
    return app;
  }

  const panicEpisode: EpisodeLogEntry = {
    id: "ep_panic",
    trigger: { kind: "ui.click", target: "BoomBtn", ts: 1 },
    steps: [
      { kind: "reducer", name: "boom", "slot-diffs": [], emits: [], ts: 2 },
    ],
    status: "panic",
  };

  it("emits a panic event enriched with stack, cause chain, category, and location", () => {
    const events: ReplayEvent[] = [];
    const app = makePanicApp();
    const report = replayEpisodes({
      app: {
        live: defined(app.live, "the app's live map"),
        slots: app.slots,
        reducers: app.reducers,
        effects: app.effects,
      },
      episodes: [panicEpisode],
      mocks: {},
      observer: (ev) => {
        events.push(ev);
        return "continue";
      },
    });

    const panic = events.find((e) => e.kind === "panic");
    expect(panic).toBeDefined();
    if (panic?.kind !== "panic") throw new Error("unreachable — narrow");
    expect(panic.message).toBe("boom in replay");
    expect(panic.category).toBe("reducer");
    // Fallback location the executor synthesises from the reducer's own name
    // when the caught throw didn't carry one.
    expect(panic.location).toBe(`reducer "boom"`);
    expect(panic.stack).toMatch(/at .+/);
    expect(panic.cause).toBeDefined();
    expect(panic.cause![0]!.message).toBe("root disk");

    // The aggregate report keeps the same fields so `--exit-code`-style
    // summaries and the CLI's "panics: <id>: <msg>" line stay accurate.
    expect(report.panics).toHaveLength(1);
    expect(report.panics[0]!.stack).toMatch(/at .+/);
    expect(report.panics[0]!.category).toBe("reducer");
  });
});
