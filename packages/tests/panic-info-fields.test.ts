// #364: `PanicInfo` declares five fields and the runtime supplied three. The
// other two read as JavaScript's `undefined` through `+`, which is how the gap
// was found — §7.2.3 told reducers to "treat both as None-equivalent", a rule
// nothing could enforce and, for a `Text`-typed `episode-id`, nothing could
// even express.
//
// The corpus example (`93-panic-info`) pins that all five are readable on the
// two paths it drives. What it cannot show is the half that needed supplying:
// `kumiki run` attaches no episode logger, so `episode-id` is legitimately
// `None` there, and `.get-or` answers the same before and after. This suite
// attaches one, and drives the example through the same two seams its scenario
// does. The third path, `route.error`, is covered in
// `packages/runtime/test/lifecycle-events.test.ts`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape, EpisodeLogger, ScenarioReport } from "@kumikijs/runtime";
import { createEpisodeLogger, panicInfo, runScenario, userPanicInfo } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "93-panic-info.kumiki");

function freshRoot(): HTMLElement {
  // Every case here shares one document, and `BREAK.reducer` navigates. Without
  // the reset the next case mounts at `/boom`, fires `breakOnEnter` on the way
  // in, and reports the reducer panic where the boundary's was expected.
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
 * Drive one of the example's two panics, with `logger` attached when one is
 * given. The reducer panic is reported through the error channel, so it is
 * claimed rather than left to fail the run.
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
  // The reason the field exists (§10.5): it is the join between a panic a user
  // saw and the episode `kumiki replay` / `kumiki_episode_tail` read. An id
  // that names no episode in the log would be a join to nothing.
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

  // The documented value for a panic outside any episode. A host that attached
  // no logger has no episode to name, and `None` is what the language can say
  // about that — which is the whole reason the field is `Option(Text)` rather
  // than the `Text` it was declared as.
  it("is None when no episode logger is attached", async () => {
    const report = await breakIt("reducer", null);
    expect(report.steps[0]?.state.caughtEp).toMatchObject({ _tag: "None" });
    expect(report.steps[0]?.domText).toContain("error episode: (none)");
  });
});

describe("cause carries the nearest reason, not the chain", () => {
  // `collectCauseChain` walks up to 8 links and keeps each one's stack. None of
  // that belongs on a production page — §7.2.3 is explicit that the chain and
  // the stack stay in the episode log — so what a program gets is the nearest
  // link's message and nothing else.
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
  // #362 aligned the boundary fallback's payload with `handleLivePanic`'s, and
  // both were then missing the same two fields in the same way. Reading every
  // field on both paths in one run is what keeps that alignment a fact rather
  // than a comment.
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
