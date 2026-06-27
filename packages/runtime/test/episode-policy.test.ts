// Coverage for issue #120 — debounce-deferred effects must still land their
// effect-start + effect-end + .ok/.err reducer chain on the SAME episode that
// the triggering reducer opened (spec §10.5.1). Before the fix, the
// `setTimeout`-deferred `launch` inside the dispatcher's debounce branch fired
// AFTER `applyReducer` already closed the episode, so:
//   1. `effect-start` dropped (topEpisode() was null)
//   2. `effect-end` opened a fresh episode via the auto-open path → causal
//      chain split across two episodes.
// The fix claims the episode token at dispatch time and propagates it through
// the timer closure into `launch`, so the deferred effect-end + .ok reducer
// reattach to the originating episode. A debounce timer that gets replaced
// before it fires records an `effect-cancel` step on its originating episode
// (the launch never happened, so it cannot be `effect-end "err"`).

import type { AppShape, EffectResult } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

type DebounceApp = {
  app: AppShape;
  resolveSearch: (value: { hits: string[] }) => void;
  searchCalls: number;
};

function makeDebounceApp(debounceMs: number): DebounceApp {
  let resolveFetch: (r: EffectResult) => void = () => {};
  const resolveSearch = (value: { hits: string[] }): void => resolveFetch({ kind: "ok", value });
  let searchCalls = 0;
  const app: AppShape = {
    slots: { q: { value: "" }, hits: { value: [] as string[] }, status: { value: "idle" } },
    caps: ["http.get"],
    effects: {
      search: {
        name: "search",
        cap: "http.get",
        policy: { kind: "debounce", ms: debounceMs },
        invoke: () =>
          new Promise<EffectResult>((resolve) => {
            searchCalls++;
            resolveFetch = resolve;
          }),
      },
    },
    init: [],
    reducers: [
      {
        name: "onInput",
        event: { kind: "ui", ev: "input" },
        selector: { tile: "Q" },
        apply: (_live, payload) => ({
          slots: { q: payload.value as string },
          emits: [{ effect: "search", args: [{ q: payload.value }] }],
        }),
      },
      {
        name: "onSearchOk",
        event: { kind: "effect", effect: "search", outcome: "ok" },
        apply: (_live, payload) => ({
          slots: { hits: (payload.$1 as { hits: string[] }).hits, status: "loaded" },
          emits: [],
        }),
      },
    ],
  };
  return {
    app,
    resolveSearch,
    get searchCalls() {
      return searchCalls;
    },
  } as DebounceApp;
}

describe("issue #120 — debounce / throttle episode fidelity", () => {
  it("debounce: deferred launch records effect-start + effect-end + .ok on the originating episode", async () => {
    const ctx = makeDebounceApp(20);
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(ctx.app, root, { episodeLogger: logger });
      const dispatch = (
        ctx.app as unknown as { _dispatch: (n: string, p: Record<string, unknown>) => void }
      )._dispatch;

      dispatch("onInput", { value: "kumiki" });
      // Episode is still open (debounce timer pending → pending counter > 0).
      expect(logger.list()).toEqual([]);

      // Wait past the debounce window for the timer to fire and launch().
      await tick(40);
      // Effect is in flight — episode still pending its effect-end.
      expect(logger.list()).toEqual([]);
      expect(ctx.searchCalls).toBe(1);

      // Resolve the search and let the .ok reducer chain run.
      ctx.resolveSearch({ hits: ["a", "b"] });
      await tick(10);

      const eps = logger.list();
      expect(eps).toHaveLength(1);
      const ep = eps[0]!;
      expect(ep.status).toBe("completed");
      const kinds = ep.steps.map((s) => s.kind);
      // The exact ordering of signal-update vs effect-start is implementation
      // detail; what we assert is that every causal-chain step rides the SAME
      // episode without splitting onto a fresh one.
      expect(kinds).toContain("reducer");
      expect(kinds).toContain("effect-start");
      expect(kinds).toContain("effect-end");
      const reducers = ep.steps.filter((s) => s.kind === "reducer");
      expect(reducers.map((s) => (s as { name: string }).name)).toEqual(["onInput", "onSearchOk"]);
      dispose();
    } finally {
      root.remove();
    }
  });

  it("debounce: a replaced timer records effect-cancel on its originating episode and the new episode owns the eventual effect-end", async () => {
    const ctx = makeDebounceApp(20);
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(ctx.app, root, { episodeLogger: logger });
      const dispatch = (
        ctx.app as unknown as { _dispatch: (n: string, p: Record<string, unknown>) => void }
      )._dispatch;

      dispatch("onInput", { value: "k" });
      // Before the first timer fires, dispatch a second input — replaces the
      // pending launch.
      await tick(5);
      dispatch("onInput", { value: "ku" });

      // The first (cancelled) episode commits as soon as its pending counter
      // hits 0 via the cancel path. The second episode is still pending its
      // effect-end.
      await tick(40);
      expect(ctx.searchCalls).toBe(1);

      ctx.resolveSearch({ hits: ["ku-result"] });
      await tick(10);

      const eps = logger.list();
      expect(eps).toHaveLength(2);

      const [first, second] = eps;
      expect(first!.status).toBe("completed");
      // The first episode lost its launch — it must carry an effect-cancel step
      // so the trace shows WHY no effect-end ever arrived.
      const firstCancels = first!.steps.filter((s) => s.kind === "effect-cancel");
      expect(firstCancels).toHaveLength(1);
      expect(firstCancels[0]).toMatchObject({ kind: "effect-cancel", targetId: "search" });
      // No effect-end on the cancelled episode.
      expect(first!.steps.some((s) => s.kind === "effect-end")).toBe(false);

      // The second episode carries the full chain.
      expect(second!.status).toBe("completed");
      expect(second!.steps.some((s) => s.kind === "effect-start")).toBe(true);
      expect(second!.steps.some((s) => s.kind === "effect-end")).toBe(true);
      const secondReducers = second!.steps.filter((s) => s.kind === "reducer");
      expect(secondReducers.map((s) => (s as { name: string }).name)).toEqual([
        "onInput",
        "onSearchOk",
      ]);
      dispose();
    } finally {
      root.remove();
    }
  });

  it("latest: an aborted old launch commits its originating episode rather than hanging in closedAwaiting", async () => {
    // Issue #120 AC #4 — verify the existing closedAwaiting machinery does not
    // strand an episode forever when `latest` aborts the prior launch. The
    // AbortError travels through the catch → onResult → recordEffectEnd path
    // and decrements the pending counter, settling the episode.
    let resolveOld: (r: EffectResult) => void = () => {};
    let resolveNew: (r: EffectResult) => void = () => {};
    let call = 0;
    const app: AppShape = {
      slots: { hits: { value: [] as string[] }, status: { value: "idle" } },
      caps: ["http.get"],
      effects: {
        search: {
          name: "search",
          cap: "http.get",
          policy: { kind: "latest" },
          invoke: (_input, _caps, signal) =>
            new Promise<EffectResult>((resolve) => {
              const me = ++call;
              if (me === 1) resolveOld = resolve;
              else resolveNew = resolve;
              signal?.addEventListener("abort", () => {
                resolve({ kind: "err", value: { status: 0, message: "aborted", body: "" } });
              });
            }),
        },
      },
      init: [],
      reducers: [
        {
          name: "kick",
          event: { kind: "ui", ev: "click" },
          selector: { tile: "Kick" },
          apply: () => ({ slots: {}, emits: [{ effect: "search", args: [{ url: "/q" }] }] }),
        },
        {
          name: "onOk",
          event: { kind: "effect", effect: "search", outcome: "ok" },
          apply: () => ({ slots: { status: "ok" }, emits: [] }),
        },
        {
          name: "onErr",
          event: { kind: "effect", effect: "search", outcome: "err" },
          apply: () => ({ slots: { status: "err" }, emits: [] }),
        },
      ],
    };
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root, { episodeLogger: logger });
      const dispatch = (
        app as unknown as { _dispatch: (n: string, p: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("kick", {});
      await tick();
      // Second dispatch aborts the first launch.
      dispatch("kick", {});
      await tick(10);
      // The old launch resolved via abort path; the new launch is still pending.
      void resolveOld;
      // Resolve the new launch.
      resolveNew({ kind: "ok", value: { hits: ["x"] } });
      await tick(10);

      const eps = logger.list();
      // Both episodes must be committed (no `ongoing` left behind).
      expect(eps.every((ep) => ep.status === "completed")).toBe(true);
      expect(eps).toHaveLength(2);
      dispose();
    } finally {
      root.remove();
    }
  });
});
