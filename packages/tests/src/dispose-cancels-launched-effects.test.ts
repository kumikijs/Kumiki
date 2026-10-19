import { readFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import {
  createEpisodeLogger,
  type Episode,
  type EpisodeLogger,
  runScenario,
  type Scenario,
} from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { click, mountApp, tick, waitUntil, withRoot } from "./helpers/dom.ts";
import {
  answerAfter,
  type FetchDouble,
  type Held,
  holdEach,
  stubFetch,
} from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";

const EXAMPLE = feature("260-dispose-cancels-launched-effects");
const SCENARIO = EXAMPLE.replace(/\.kumiki$/, ".scenario.json");

const busy = (): Response =>
  new Response("busy", { status: 503, statusText: "Service Unavailable" });
const quote = (): Response =>
  new Response(JSON.stringify({ text: "Fresh quote", author: "B" }), { status: 200 });

let double: FetchDouble | undefined;

afterEach(() => {
  double?.restore();
  double = undefined;
});

function recording(): { logger: EpisodeLogger; committed: Episode[] } {
  const committed: Episode[] = [];
  return { logger: createEpisodeLogger({ onEpisode: (ep) => committed.push(ep) }), committed };
}

const kinds = (eps: Episode[]): string[] => eps.flatMap((ep) => ep.steps.map((s) => s.kind));

/** The click's episode, ending where dispose cancelled its request. */
function expectCancelledClick(committed: Episode[]): void {
  expect(committed).toHaveLength(1);
  expect(committed[0]?.trigger).toMatchObject({ kind: "ui.click", target: "LoadBtn" });
  expect(committed[0]?.steps.at(-1)).toMatchObject({
    kind: "effect-cancel",
    targetId: "loadQuote",
  });
  expect(kinds(committed)).not.toContain("effect-end");
}

describe("disposing the app with a request it launched still going", () => {
  it("commits the episode of a request in flight, with an effect-cancel, before dispose returns", async () => {
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    const { logger, committed } = recording();
    const shape = await loadApp(EXAMPLE);
    const { root, handle } = mountApp(shape, { episodeLogger: logger });
    click(root, "Load");
    await waitUntil(() => held.length === 1);

    handle.dispose();
    root.remove();

    expectCancelledClick(committed);
    expect(held[0]?.signal?.aborted).toBe(true);
    await tick(20);
    expect(committed).toHaveLength(1);
    expect(shape.live?.status).toBe("loading");
  });

  it("commits the episode of a request in its retry backoff the same way, and makes no further attempt", async () => {
    const server = answerAfter(0, [busy, quote]);
    double = stubFetch(server.respond);
    const { logger, committed } = recording();
    const shape = await loadApp(EXAMPLE);
    const { root, handle } = mountApp(shape, { episodeLogger: logger });
    click(root, "Load");
    await waitUntil(() => server.answered() === 1);
    await tick(20);

    handle.dispose();
    root.remove();

    expectCancelledClick(committed);
    await tick(600);
    expect(double.calls).toHaveLength(1);
    expect(committed).toHaveLength(1);
    expect(shape.live?.status).toBe("loading");
  });
});

describe("a scenario that ends while a request waits in its retry backoff", () => {
  it("has committed that request's episode, with an effect-cancel, by the time it returns", async () => {
    const { logger, committed } = recording();
    const shape = await loadApp(EXAMPLE);
    const scenario = JSON.parse(readFileSync(SCENARIO, "utf8")) as Scenario;

    const report = await withRoot((root) =>
      runScenario(shape, root, scenario, { episodeLogger: logger }),
    );

    expect(report.ok, failureDetail(report)).toBe(true);
    expectCancelledClick(committed);
    await tick(600);
    expect(committed).toHaveLength(1);
    expect(shape.live?.status).toBe("loading");
  });
});
