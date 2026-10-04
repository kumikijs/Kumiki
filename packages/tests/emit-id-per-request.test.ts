// Under a policy other than `latest` / `latest-per-key`, two emits of one
// effect are two requests, and the id each `emit` yields names the request it
// started (http.md §6.4). What is pinned here is the round trip through the
// real dispatcher and a `fetch` double that holds every request until the test
// answers it or the request is aborted: cancelling one id aborts that request
// and leaves the others running. Nothing in this file restates how an id is
// built.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape, EpisodeLogEntry, EpisodeStep } from "@kumikijs/runtime";
import { createEpisodeLogger, mount, replayEpisodes, runScenario } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickByText, type FetchCall, type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "184-emit-id-per-request.kumiki");

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A request the double is holding: where it went, its signal, and how to answer it. */
type Held = { url: string; signal: AbortSignal | null | undefined; answer: (text: string) => void };

/**
 * A responder that answers nothing on its own. Each request waits in `held`
 * until the test calls its `answer`, and fails the way `fetch` does if its
 * signal is aborted first.
 */
function holdEach(held: Held[]): (call: FetchCall) => Promise<Response> {
  return (call) =>
    new Promise<Response>((resolve, reject) => {
      const signal = call.init.signal;
      held.push({ url: call.url, signal, answer: (text) => resolve(new Response(text)) });
      signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    });
}

function heldAt(held: Held[], i: number): Held {
  const h = held[i];
  if (!h) throw new Error(`no request #${i} was made; made: ${held.map((x) => x.url).join(", ")}`);
  return h;
}

let double: FetchDouble | undefined;

afterEach(() => {
  double?.restore();
  double = undefined;
});

/** Mount `app`, run `body` against its root, and tear both down whatever happens. */
async function withMounted(app: AppShape, body: (root: HTMLElement) => Promise<void>) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const { dispose } = mount(app, root);
  try {
    await body(root);
  } finally {
    dispose();
    root.remove();
  }
}

describe("two requests one reducer started, under no policy", () => {
  it("cancelling the first id aborts the first request and the second completes", async () => {
    const app = await loadApp(EXAMPLE);
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      clickByText(root, "Start");
      await tick();
      expect(held.map((h) => h.url)).toEqual(["/api/parts/a", "/api/parts/b"]);
      expect(root.textContent).toContain("same id: false");

      clickByText(root, "Cancel a");
      await tick();
      expect(held.map((h) => h.signal?.aborted)).toEqual([true, false]);

      heldAt(held, 1).answer("part b");
      await tick();
      expect(root.textContent).toContain("status: [a aborted] [part b]");
    });
  });
});

/** One `work` effect under `policy`, reducers that emit it, and two that cancel the ids they kept. */
function workApp(policy: string): string {
  return `slot idA : EffectId = EffectId.none
slot idB : EffectId = EffectId.none
slot log : Text     = ""
effect work cap=http.get in=Text out=Result(Text, HttpError)
            ${policy}
            map-request={url: "/work/" + $1, decode: Decoder.Text}
effect cancelWork cap=http.cancel in=EffectId out=Unit
reducer goA   on=ui.click(GoABtn)   do= idA := emit work("a")
reducer goB   on=ui.click(GoBBtn)   do= idB := emit work("b")
reducer goAll on=ui.click(GoAllBtn) do= idA := emit work("a")
                                        idB := emit work("b")
                                        emit work("c")
reducer stopA on=ui.click(StopABtn) do= emit cancelWork(idA)
reducer stopB on=ui.click(StopBBtn) do= emit cancelWork(idB)
reducer onOk  on=work.ok($body, _)  do= log := log + " [" + $body + "]"
reducer onErr on=work.err($err, $w) do= log := log + " [" + $w + " " + $err.message + "]"
tile GoABtn   = button(text="GoA", onClick=goA)
tile GoBBtn   = button(text="GoB", onClick=goB)
tile GoAllBtn = button(text="GoAll", onClick=goAll)
tile StopABtn = button(text="StopA", onClick=stopA)
tile StopBBtn = button(text="StopB", onClick=stopB)
tile App = column(GoABtn, GoBBtn, GoAllBtn, StopABtn, StopBBtn, text("log:" + log))
app M caps=[http.get, http.cancel] routes={"/" -> App, "/404" -> App} init=[]`;
}

describe("`emit cancel(idA)` aborts request A alone while B is in flight too", () => {
  // Every policy that lets two requests of one effect be in flight together.
  // `a` is emitted first and is still in flight when `b` is: a debounce fires
  // and a throttle window closes well inside the wait between the two clicks.
  it.each([
    ["no policy", ""],
    ["once", "policy=once"],
    ["throttle", "policy=throttle(5ms)"],
    ["debounce", "policy=debounce(5ms)"],
  ])("%s", { timeout: 30_000 }, async (_label, policy) => {
    const app = await loadSource(workApp(policy));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      clickByText(root, "GoA");
      await tick();
      clickByText(root, "GoB");
      await tick();
      expect(held.map((h) => h.url)).toEqual(["/work/a", "/work/b"]);

      clickByText(root, "StopA");
      await tick();
      expect(held.map((h) => h.signal?.aborted)).toEqual([true, false]);

      heldAt(held, 1).answer("done b");
      await tick();
      expect(root.textContent).toContain("log: [a aborted] [done b]");
    });
  });
});

describe("cancelling one id under `policy=queue`", () => {
  it("drops a waiting entry alone: the queue runs the ones around it", async () => {
    const app = await loadSource(workApp("policy=queue"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      clickByText(root, "GoAll");
      await tick();
      expect(held.map((h) => h.url)).toEqual(["/work/a"]);

      clickByText(root, "StopB");
      await tick();
      expect(heldAt(held, 0).signal?.aborted).toBe(false);

      heldAt(held, 0).answer("done a");
      await tick();
      expect(held.map((h) => h.url)).toEqual(["/work/a", "/work/c"]);
      heldAt(held, 1).answer("done c");
      await tick();
      // `b` never started, so there was no request to abort and no `.err`.
      expect(root.textContent).toContain("log: [done a] [done c]");
    });
  });

  it("aborts the running entry alone: the queue goes on with the next", async () => {
    const app = await loadSource(workApp("policy=queue"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      clickByText(root, "GoAll");
      await tick();
      clickByText(root, "StopA");
      await tick();
      expect(heldAt(held, 0).signal?.aborted).toBe(true);
      expect(held.map((h) => h.url)).toEqual(["/work/a", "/work/b"]);

      heldAt(held, 1).answer("done b");
      await tick();
      heldAt(held, 2).answer("done c");
      await tick();
      expect(held.map((h) => h.url)).toEqual(["/work/a", "/work/b", "/work/c"]);
      expect(root.textContent).toContain("log: [a aborted] [done b] [done c]");
    });
  });
});

describe("cancelling one id under `policy=debounce` before the timer fires", () => {
  it("drops the emit waiting on the timer", async () => {
    const app = await loadSource(workApp("policy=debounce(40ms)"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      clickByText(root, "GoA");
      clickByText(root, "StopA");
      await tick(80);
      expect(held.map((h) => h.url)).toEqual([]);
    });
  });

  it("names nothing once a later emit replaced it: the later one still runs", async () => {
    const app = await loadSource(workApp("policy=debounce(40ms)"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      clickByText(root, "GoA");
      clickByText(root, "GoB");
      clickByText(root, "StopA");
      await tick(80);
      expect(held.map((h) => h.url)).toEqual(["/work/b"]);
      expect(heldAt(held, 0).signal?.aborted).toBe(false);
    });
  });
});

type ReducerStep = Extract<EpisodeStep, { kind: "reducer" }>;

describe("replaying an episode whose reducer kept two ids", () => {
  it("reproduces the ids the recording yielded", async () => {
    const recorded = await loadApp(EXAMPLE);
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    let ep: EpisodeLogEntry;
    try {
      const report = await runScenario(
        recorded,
        root,
        { steps: [{ do: { click: "#start" } }] },
        { episodeLogger: logger },
      );
      expect(report.ok).toBe(true);
      // Through JSON, because that is how an episode reaches `kumiki replay`.
      ep = JSON.parse(JSON.stringify(logger.list()[0])) as EpisodeLogEntry;
    } finally {
      root.remove();
    }
    const start = ep.steps.find((s): s is ReducerStep => s.kind === "reducer");
    const kept = Object.fromEntries((start?.["slot-diffs"] ?? []).map((d) => [d.name, d.after]));
    expect(kept.idA).not.toBe(kept.idB);

    for (let i = 0; i < 2; i++) {
      const app = (await loadApp(EXAMPLE)) as AppShape & { live: Record<string, unknown> };
      const { finalSlots } = replayEpisodes({
        app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
        episodes: [ep],
        mocks: {},
        observer: () => "continue",
      });
      expect({ idA: finalSlots.idA, idB: finalSlots.idB }).toEqual({
        idA: kept.idA,
        idB: kept.idB,
      });
    }
  });
});
