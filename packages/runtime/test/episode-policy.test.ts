// Invariant (spec §10.5.1): the causal chain from a single trigger lives on
// one episode. A `policy=debounce(d)` effect emits inside the triggering
// reducer but its `launch` is deferred via `setTimeout`, so the dispatcher
// claims the episode token at *dispatch* time and threads it into `launch`
// via a preset-token handle. The eventual `effect-start` / `effect-end` /
// `.ok` reducer chain reattach to the originating episode. A debounce timer
// dropped before it fires (replace, `http.cancel`, `dispose`) records an
// `effect-cancel` step on its originating episode and settles it; the
// launch never happened, so it cannot be `effect-end "err"`.

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

describe("policy-deferred effect episode fidelity (§10.5.1)", () => {
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
    // Verify the existing closedAwaiting machinery does not strand an episode
    // forever when `latest` aborts the prior launch. The AbortError travels
    // through the catch → onResult → recordEffectEnd path and decrements the
    // pending counter, settling the episode.
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

  it("debounce: dispose() during the pending window drains the timer and commits the originating episode", async () => {
    const ctx = makeDebounceApp(50);
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(ctx.app, root, { episodeLogger: logger });
      const dispatch = (
        ctx.app as unknown as { _dispatch: (n: string, p: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("onInput", { value: "kumiki" });
      // Episode is still open (debounce timer pending).
      expect(logger.list()).toEqual([]);
      // Tear the runtime down BEFORE the debounce window elapses.
      dispose();

      const eps = logger.list();
      expect(eps).toHaveLength(1);
      expect(eps[0]!.status).toBe("completed");
      const cancels = eps[0]!.steps.filter((s) => s.kind === "effect-cancel");
      expect(cancels).toHaveLength(1);
      expect(cancels[0]).toMatchObject({ kind: "effect-cancel", targetId: "search" });
      // No effect-end — the launch never fired.
      expect(eps[0]!.steps.some((s) => s.kind === "effect-end")).toBe(false);
      // Subsequent ticks must not produce a phantom second launch.
      expect(ctx.searchCalls).toBe(0);
    } finally {
      root.remove();
    }
  });

  it("debounce: http.cancel during the pending window clears the timer and commits the originating episode", async () => {
    // User-initiated `http.cancel` of a pending debounce: the timer is cleared
    // and the originating episode must release its claimed effect-start so it
    // can commit instead of stranding in `closedAwaiting`.
    const app: AppShape = {
      slots: { q: { value: "" }, status: { value: "idle" } },
      caps: ["http.get", "http.cancel"],
      effects: {
        search: {
          name: "search",
          cap: "http.get",
          policy: { kind: "debounce", ms: 50 },
          invoke: async () => ({ kind: "ok", value: { hits: [] } }),
        },
        cancel: {
          name: "cancel",
          cap: "http.cancel",
          invoke: async () => ({ kind: "ok", value: null }),
        },
      },
      init: [],
      reducers: [
        {
          name: "onInput",
          event: { kind: "ui", ev: "input" },
          selector: { tile: "Q" },
          apply: (_l, p) => ({
            slots: { q: p.value as string },
            emits: [{ effect: "search", args: [{ q: p.value }] }],
          }),
        },
        {
          name: "kill",
          event: { kind: "ui", ev: "click" },
          selector: { tile: "Kill" },
          apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["search:_"] }] }),
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
      dispatch("onInput", { value: "kumiki" });
      // Episode for the ui.input is held open by the pending debounce.
      expect(logger.list()).toEqual([]);
      dispatch("kill", {});
      // After http.cancel, both the ui.input episode AND the ui.click episode
      // commit. Wait a tick past the original debounce window to catch a
      // phantom late launch if one slipped through.
      await tick(70);

      const eps = logger.list();
      expect(eps.length).toBeGreaterThanOrEqual(2);
      const inputEp = eps.find((ep) => ep.trigger.kind === "ui.input");
      expect(inputEp).toBeDefined();
      expect(inputEp!.status).toBe("completed");
      // The originating ui.input episode carries the policy-cancel step
      // (targetId = effect name), not the user-cancel intent.
      const inputCancels = inputEp!.steps.filter((s) => s.kind === "effect-cancel");
      expect(inputCancels).toHaveLength(1);
      expect(inputCancels[0]).toMatchObject({ kind: "effect-cancel", targetId: "search" });
      // The ui.click cancel episode separately records the user-cancel intent
      // (targetId = full effect-id).
      const clickEp = eps.find((ep) => ep.trigger.kind === "ui.click");
      expect(clickEp).toBeDefined();
      const clickCancels = clickEp!.steps.filter((s) => s.kind === "effect-cancel");
      expect(clickCancels).toHaveLength(1);
      expect(clickCancels[0]).toMatchObject({ kind: "effect-cancel", targetId: "search:_" });
      dispose();
    } finally {
      root.remove();
    }
  });

  it("debounce: a missing capability at launch releases the claimed token instead of stranding the episode", async () => {
    // `caps.has(eff.cap)` is checked inside `launch`, so for a debounced
    // effect the cap might already be missing by the time the timer fires.
    // The early-return must release the dispatch-time token so the
    // originating episode commits with an effect-cancel.
    const app: AppShape = {
      slots: { q: { value: "" } },
      // Note: omit "http.get" so the dispatcher's launch path warns + bails.
      caps: [],
      effects: {
        search: {
          name: "search",
          cap: "http.get",
          policy: { kind: "debounce", ms: 20 },
          invoke: async () => ({ kind: "ok", value: { hits: [] } }),
        },
      },
      init: [],
      reducers: [
        {
          name: "onInput",
          event: { kind: "ui", ev: "input" },
          selector: { tile: "Q" },
          apply: (_l, p) => ({
            slots: { q: p.value as string },
            emits: [{ effect: "search", args: [{ q: p.value }] }],
          }),
        },
      ],
    };
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const { dispose } = mount(app, root, { episodeLogger: logger });
      const dispatch = (
        app as unknown as { _dispatch: (n: string, p: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("onInput", { value: "kumiki" });
      // Wait past the debounce window so launch() fires and bails on the cap.
      await tick(40);

      const eps = logger.list();
      expect(eps).toHaveLength(1);
      expect(eps[0]!.status).toBe("completed");
      expect(eps[0]!.steps.some((s) => s.kind === "effect-cancel")).toBe(true);
      // No effect-end — the cap gate stopped the launch before invoke().
      expect(eps[0]!.steps.some((s) => s.kind === "effect-end")).toBe(false);
      dispose();
    } finally {
      console.warn = origWarn;
      root.remove();
    }
  });
});
