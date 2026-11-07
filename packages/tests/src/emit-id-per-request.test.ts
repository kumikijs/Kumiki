import { feature } from "@kumikijs/examples";
import type { EpisodeLogEntry } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { click, tick, waitUntil, withMounted } from "./helpers/dom.ts";
import { afterValues, recordOne, reducerStep, replayEpisode } from "./helpers/episodes.ts";
import { type FetchDouble, type Held, heldAt, holdEach, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("184-emit-id-per-request");

// Outlasts the 5ms debounce and throttle windows below, so a timer has expired before the next
// click. Only timer expiry is ordered by it: what a request does is waited for with `waitUntil`.
const SETTLE = 30;

let double: FetchDouble | undefined;

afterEach(() => {
  double?.restore();
  double = undefined;
});

/** Wait until `root` shows `text`, then check it does. */
async function shows(root: HTMLElement, text: string): Promise<void> {
  await waitUntil(() => (root.textContent ?? "").includes(text));
  expect(root.textContent).toContain(text);
}

describe("two requests one reducer started, under no policy", () => {
  it("cancelling the first id aborts the first request and the second completes", async () => {
    const app = await loadApp(EXAMPLE);
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "Start");
      await waitUntil(() => held.length === 2);
      expect(held.map((h) => h.url)).toEqual(["/api/parts/a", "/api/parts/b"]);
      expect(root.textContent).toContain("same id: false");

      click(root, "Cancel a");
      await waitUntil(() => heldAt(held, 0).signal?.aborted === true);
      expect(held.map((h) => h.signal?.aborted)).toEqual([true, false]);

      heldAt(held, 1).answer("part b");
      await shows(root, "status: [a aborted] [part b]");
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
reducer goA    on=ui.click(GoABtn)    do= idA := emit work("a")
reducer goB    on=ui.click(GoBBtn)    do= idB := emit work("b")
reducer againA on=ui.click(AgainABtn) do= idB := emit work("a")
reducer goAll  on=ui.click(GoAllBtn)  do= idA := emit work("a")
                                          idB := emit work("b")
                                          emit work("c")
reducer goMix  on=ui.click(GoMixBtn)  do= emit work("s")
                                          idA := emit work("a")
                                          emit work("t")
                                          idB := emit work("b")
reducer stopA  on=ui.click(StopABtn)  do= emit cancelWork(idA)
reducer stopB  on=ui.click(StopBBtn)  do= emit cancelWork(idB)
reducer onOk   on=work.ok($body, _)   do= log := log + " [" + $body + "]"
reducer onErr  on=work.err($err, $w)  do= log := log + " [" + $w + " " + $err.message + "]"
tile GoABtn    = button(text="GoA", onClick=goA)
tile GoBBtn    = button(text="GoB", onClick=goB)
tile AgainABtn = button(text="AgainA", onClick=againA)
tile GoAllBtn  = button(text="GoAll", onClick=goAll)
tile GoMixBtn  = button(text="GoMix", onClick=goMix)
tile StopABtn  = button(text="StopA", onClick=stopA)
tile StopBBtn  = button(text="StopB", onClick=stopB)
tile App = column(GoABtn, GoBBtn, AgainABtn, GoAllBtn, GoMixBtn, StopABtn, StopBBtn, text("log:" + log))
app M caps=[http.get, http.cancel] routes={"/" -> App, "/404" -> App} init=[]`;
}

describe("`emit cancel(idA)` aborts request A alone while B is in flight too", () => {
  it.each([
    ["no policy", ""],
    ["once", "policy=once"],
    ["throttle", "policy=throttle(5ms)"],
    ["debounce", "policy=debounce(5ms)"],
  ])("%s", async (_label, policy) => {
    const app = await loadSource(workApp(policy));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "GoA");
      await waitUntil(() => held.length === 1);
      // The throttle window closes before the second click.
      await tick(SETTLE);
      click(root, "GoB");
      await waitUntil(() => held.length === 2);
      expect(held.map((h) => h.url)).toEqual(["/work/a", "/work/b"]);

      click(root, "StopA");
      await waitUntil(() => heldAt(held, 0).signal?.aborted === true);
      expect(held.map((h) => h.signal?.aborted)).toEqual([true, false]);

      heldAt(held, 1).answer("done b");
      await shows(root, "log: [a aborted] [done b]");
    });
  });
});

describe("the id of an emit the policy dropped names the request that absorbed it", () => {
  it("throttle: an emit inside the window names the request that opened it", async () => {
    const app = await loadSource(workApp("policy=throttle(1000ms)"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "GoA");
      click(root, "GoB");
      await waitUntil(() => held.length === 1);
      click(root, "StopB");
      await waitUntil(() => heldAt(held, 0).signal?.aborted === true);
      await shows(root, "log: [a aborted]");
      expect(held.map((h) => h.url)).toEqual(["/work/a"]);
    });
  });

  it("once: an emit of an input already seen names the request that input launched", async () => {
    const app = await loadSource(workApp("policy=once"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "GoA");
      click(root, "AgainA");
      await waitUntil(() => held.length === 1);
      click(root, "StopB");
      await waitUntil(() => heldAt(held, 0).signal?.aborted === true);
      await shows(root, "log: [a aborted]");
      expect(held.map((h) => h.url)).toEqual(["/work/a"]);
    });
  });

  it("debounce: an emit replaced before the timer fired names the one that replaced it", async () => {
    const app = await loadSource(workApp("policy=debounce(40ms)"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "GoA");
      click(root, "GoB");
      await waitUntil(() => held.length === 1);
      expect(held.map((h) => h.url)).toEqual(["/work/b"]);
      click(root, "StopA");
      await waitUntil(() => heldAt(held, 0).signal?.aborted === true);
      await shows(root, "log: [b aborted]");
    });
  });

  it("debounce: before the timer fires, a cancel through the replaced id drops the pending emit", async () => {
    const app = await loadSource(workApp("policy=debounce(40ms)"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "GoA");
      click(root, "GoB");
      click(root, "StopA");
      await tick(80);
      expect(held.map((h) => h.url)).toEqual([]);
    });
  });

  it("names nothing once the absorbing request settled", async () => {
    const app = await loadSource(workApp("policy=throttle(1000ms)"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "GoA");
      await waitUntil(() => held.length === 1);
      heldAt(held, 0).answer("done a");
      await shows(root, "log: [done a]");
      // The window is still open, so this emit is dropped, and nothing is left to absorb it.
      click(root, "GoB");
      click(root, "StopB");
      await tick(SETTLE);
      expect(root.textContent).toContain("log: [done a]");
      expect(root.textContent).not.toContain("aborted");
    });
  });
});

describe("cancelling one id under `policy=queue`", () => {
  it("drops a waiting entry alone: the queue runs the ones around it", async () => {
    const app = await loadSource(workApp("policy=queue"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "GoAll");
      await waitUntil(() => held.length === 1);
      expect(held.map((h) => h.url)).toEqual(["/work/a"]);

      click(root, "StopB");
      await tick(SETTLE);
      expect(heldAt(held, 0).signal?.aborted).toBe(false);

      heldAt(held, 0).answer("done a");
      await waitUntil(() => held.length === 2);
      expect(held.map((h) => h.url)).toEqual(["/work/a", "/work/c"]);
      heldAt(held, 1).answer("done c");
      // `b` never started, so there was no request to abort and no `.err`.
      await shows(root, "log: [done a] [done c]");
    });
  });

  it("aborts the running entry alone: the queue goes on with the next", async () => {
    const app = await loadSource(workApp("policy=queue"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "GoAll");
      await waitUntil(() => held.length === 1);
      click(root, "StopA");
      await waitUntil(() => held.length === 2);
      expect(heldAt(held, 0).signal?.aborted).toBe(true);
      expect(held.map((h) => h.url)).toEqual(["/work/a", "/work/b"]);

      heldAt(held, 1).answer("done b");
      await waitUntil(() => held.length === 3);
      heldAt(held, 2).answer("done c");
      await shows(root, "log: [a aborted] [done b] [done c]");
      expect(held.map((h) => h.url)).toEqual(["/work/a", "/work/b", "/work/c"]);
    });
  });
});

describe("cancelling one id under `policy=debounce`", () => {
  it("drops the emit waiting on the timer", async () => {
    const app = await loadSource(workApp("policy=debounce(40ms)"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "GoA");
      click(root, "StopA");
      await tick(80);
      expect(held.map((h) => h.url)).toEqual([]);
    });
  });

  it("leaves a request the timer already fired running: it is a request of its own", async () => {
    const app = await loadSource(workApp("policy=debounce(5ms)"));
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    await withMounted(app, async (root) => {
      click(root, "GoA");
      await waitUntil(() => held.length === 1);
      click(root, "GoB");
      click(root, "StopB");
      await tick(SETTLE);
      expect(held.map((h) => h.url)).toEqual(["/work/a"]);
      expect(heldAt(held, 0).signal?.aborted).toBe(false);
      heldAt(held, 0).answer("done a");
      await shows(root, "log: [done a]");
    });
  });
});

describe("replaying an episode whose reducer kept two ids", () => {
  const load = () => loadApp(EXAMPLE);
  const record = () => recordOne(load, { do: { click: "#start" } });

  it("records each id as an effect-id read and reproduces it, with no drift", async () => {
    const ep = await record();
    expect((reducerStep(ep)["env-reads"] ?? []).map((r) => r.kind)).toEqual([
      "effect-id",
      "effect-id",
    ]);
    const kept = afterValues(ep);
    expect(kept.idA).not.toBe(kept.idB);

    for (let i = 0; i < 2; i++) {
      const { finalSlots, envDrift } = await replayEpisode(load, ep);
      expect({ idA: finalSlots.idA, idB: finalSlots.idB }).toEqual({
        idA: kept.idA,
        idB: kept.idB,
      });
      expect(envDrift).toEqual({ live: 0, unused: 0, malformed: 0 });
    }
  });

  it("reads the ids live from a log that recorded none, and reports both", async () => {
    const ep = await record();
    const older: EpisodeLogEntry = {
      ...ep,
      steps: ep.steps.map((s) => {
        if (s.kind !== "reducer") return s;
        const { "env-reads": _reads, ...rest } = s;
        return rest;
      }),
    };
    const { finalSlots, envDrift } = await replayEpisode(load, older);
    expect(envDrift).toEqual({ live: 2, unused: 0, malformed: 0 });
    expect(finalSlots.idA).not.toBe(afterValues(ep).idA);
  });

  it("records only the ids an `emit` expression keeps, beside statement emits", async () => {
    const load = () => loadSource(workApp(""));
    double = stubFetch(() => new Response("ok"));
    const ep = await recordOne(load, { do: { clickText: "GoMix" } });
    const step = reducerStep(ep);
    expect(step.name).toBe("goMix");
    // Four emits, two of them expressions: a statement emit is minted at dispatch, unrecorded.
    expect((step["env-reads"] ?? []).map((r) => r.kind)).toEqual(["effect-id", "effect-id"]);
    const { finalSlots, envDrift } = await replayEpisode(load, ep);
    const kept = afterValues(ep);
    expect({ idA: finalSlots.idA, idB: finalSlots.idB }).toEqual({ idA: kept.idA, idB: kept.idB });
    expect(envDrift).toEqual({ live: 0, unused: 0, malformed: 0 });
  });
});
