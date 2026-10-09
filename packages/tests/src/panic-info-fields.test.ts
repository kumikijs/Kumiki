import { feature } from "@kumikijs/examples";
import type { AppShape, EpisodeLogger, ScenarioReport } from "@kumikijs/runtime";
import { createEpisodeLogger, panicInfo, runScenario, userPanicInfo } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("93-panic-info");

function freshRoot(): HTMLElement {
  window.history.replaceState(null, "", "/");
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

/** `Some(x)` unwrapped, or a failure naming what was there instead. */
function some(v: unknown): string {
  expect(v, JSON.stringify(v)).toMatchObject({ _tag: "Some" });
  return (v as { _0: string })._0;
}

/** The example's two ways to panic: the button, and the route. */
const BREAK = {
  render: { click: "#break-render" },
  reducer: { navigate: "/boom" },
} as const;

/**
 * Drive one of the example's two panics, with `logger` attached when one is given.
 * The reducer panic is reported through the error channel, so it is claimed rather than left to fail the run.
 */
async function breakIt(
  how: keyof typeof BREAK,
  logger: EpisodeLogger | null,
): Promise<ScenarioReport> {
  const app: AppShape = await loadApp(EXAMPLE);
  return runScenario(
    app,
    freshRoot(),
    { steps: [{ do: BREAK[how], expect: { errorIncludes: ["panic in"] } }] },
    logger ? { episodeLogger: logger } : {},
  );
}

describe("episode-id names the episode the panic happened in", () => {
  it("gives app.error an id that is in the log", async () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const report = await breakIt("reducer", logger);
    const id = some(report.steps[0]?.state.caughtEp);
    const ep = logger.list().find((e) => e.id === id);
    // …and it is the episode that recorded THIS panic, not merely some episode.
    expect(ep, `no episode ${id} in the log`).toBeDefined();
    expect(ep?.status).toBe("panic");
    expect(ep?.steps.some((s) => s.kind === "panic")).toBe(true);
  });

  it("gives an error-boundary fallback the same id, rendered", async () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const report = await breakIt("render", logger);
    const id = logger.list().at(-1)?.id;
    expect(id).toMatch(/^ep_/);
    expect(report.steps[0]?.domText).toContain(`fallback episode: ${id}`);
  });

  it("is None when no episode logger is attached", async () => {
    const report = await breakIt("reducer", null);
    expect(report.steps[0]?.state.caughtEp).toMatchObject({ _tag: "None" });
    expect(report.steps[0]?.domText).toContain("error episode: (none)");
  });
});

describe("cause carries the nearest reason, not the chain", () => {
  const info = (e: unknown, episodeId?: string): ReturnType<typeof userPanicInfo> =>
    userPanicInfo(panicInfo(e, "tile-render"), "Report", episodeId);

  it("is Some(the nearest cause message)", () => {
    const inner = new Error("the socket closed");
    expect(some(info(new Error("could not load the report", { cause: inner })).cause)).toBe(
      "the socket closed",
    );
  });

  it("is None when the throw carried no cause", () => {
    expect(info(new Error("plain")).cause).toMatchObject({ _tag: "None" });
  });

  it("carries neither the stack nor the links behind the nearest one", () => {
    const root = new Error("the root reason");
    const mid = new Error("the middle", { cause: root });
    const built = info(new Error("outer", { cause: mid }));
    expect(some(built.cause)).toBe("the middle");
    const json = JSON.stringify(built);
    expect(json).not.toContain("the root reason");
    expect(json).not.toContain("at ");
  });

  it("exposes exactly the five fields the type declares", () => {
    expect(Object.keys(info(new Error("x"), "ep_TEST")).sort()).toEqual([
      "category",
      "cause",
      "episode-id",
      "location",
      "message",
    ]);
  });
});

describe("the two payloads cannot drift apart", () => {
  it("the fallback and app.error report the same five field names", async () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const app: AppShape = await loadApp(EXAMPLE);
    const report = await runScenario(
      app,
      freshRoot(),
      {
        steps: [
          { do: BREAK.render },
          { do: BREAK.reducer, expect: { errorIncludes: ["panic in reducer"] } },
        ],
      },
      { episodeLogger: logger },
    );
    const text = report.steps.map((s) => s.domText).join("\n");
    for (const field of ["message", "location", "category", "episode", "cause"]) {
      expect(text, field).toContain(`fallback ${field}: `);
      expect(text, field).toContain(`error ${field}: `);
    }
    expect(text).not.toContain("undefined");
  });
});
