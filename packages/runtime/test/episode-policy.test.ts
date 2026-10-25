import type { AppShape, EffectResult, EpisodeStep, MountedApp } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { tick } from "./helpers/time.ts";

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

function mountLogged(app: AppShape) {
  const logger = createEpisodeLogger({ memoryMax: 10 });
  const { dispose } = mount(app, freshRoot(), { episodeLogger: logger });
  return { logger, dispose, dispatch: (app as MountedApp)._dispatch };
}

const reducerNames = (steps: EpisodeStep[]): string[] =>
  steps.flatMap((s) => (s.kind === "reducer" ? [s.name] : []));

const cancels = (steps: EpisodeStep[]) => steps.filter((s) => s.kind === "effect-cancel");

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("policy-deferred effect episode fidelity", () => {
  it("debounce: deferred launch records effect-start + effect-end + .ok on the originating episode", async () => {
    const ctx = makeDebounceApp(20);
    const { logger, dispose, dispatch } = mountLogged(ctx.app);

    dispatch("onInput", { value: "kumiki" });
    expect(logger.list()).toEqual([]);

    await tick(40);
    expect(logger.list()).toEqual([]);
    expect(ctx.searchCalls).toBe(1);

    ctx.resolveSearch({ hits: ["a", "b"] });
    await tick(10);

    const eps = logger.list();
    expect(eps).toHaveLength(1);
    const ep = eps[0]!;
    expect(ep.status).toBe("completed");
    // Only membership is asserted: the order of signal-update against effect-start is not the point.
    const kinds = ep.steps.map((s) => s.kind);
    expect(kinds).toContain("effect-start");
    expect(kinds).toContain("effect-end");
    expect(reducerNames(ep.steps)).toEqual(["onInput", "onSearchOk"]);
    dispose();
  });

  it("debounce: a replaced timer records effect-cancel on its originating episode and the new episode owns the eventual effect-end", async () => {
    const DEBOUNCE_MS = 200;
    const ctx = makeDebounceApp(DEBOUNCE_MS);
    const { logger, dispose, dispatch } = mountLogged(ctx.app);

    dispatch("onInput", { value: "k" });
    await tick(20);
    expect(ctx.searchCalls, "first debounce timer must not have fired yet").toBe(0);
    dispatch("onInput", { value: "ku" });

    await tick(DEBOUNCE_MS + 100);
    expect(ctx.searchCalls).toBe(1);

    ctx.resolveSearch({ hits: ["ku-result"] });
    await tick(10);

    const [first, second, ...rest] = logger.list();
    expect(rest).toEqual([]);
    expect(first!.status).toBe("completed");
    expect(cancels(first!.steps)).toEqual([
      expect.objectContaining({ kind: "effect-cancel", targetId: "search" }),
    ]);
    expect(first!.steps.some((s) => s.kind === "effect-end")).toBe(false);

    expect(second!.status).toBe("completed");
    expect(second!.steps.some((s) => s.kind === "effect-start")).toBe(true);
    expect(second!.steps.some((s) => s.kind === "effect-end")).toBe(true);
    expect(reducerNames(second!.steps)).toEqual(["onInput", "onSearchOk"]);
    dispose();
  });

  it("latest: an aborted old launch commits its originating episode rather than hanging in closedAwaiting", async () => {
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
              if (++call > 1) resolveNew = resolve;
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
    const { logger, dispose, dispatch } = mountLogged(app);
    dispatch("kick", {});
    await tick(5);
    dispatch("kick", {});
    await tick(10);
    resolveNew({ kind: "ok", value: { hits: ["x"] } });
    await tick(10);

    const eps = logger.list();
    expect(eps.every((ep) => ep.status === "completed")).toBe(true);
    expect(eps).toHaveLength(2);
    dispose();
  });

  it("debounce: dispose() during the pending window drains the timer and commits the originating episode", () => {
    const ctx = makeDebounceApp(50);
    const { logger, dispose, dispatch } = mountLogged(ctx.app);
    dispatch("onInput", { value: "kumiki" });
    expect(logger.list()).toEqual([]);
    dispose();

    const eps = logger.list();
    expect(eps).toHaveLength(1);
    expect(eps[0]!.status).toBe("completed");
    expect(cancels(eps[0]!.steps)).toEqual([
      expect.objectContaining({ kind: "effect-cancel", targetId: "search" }),
    ]);
    expect(eps[0]!.steps.some((s) => s.kind === "effect-end")).toBe(false);
    expect(ctx.searchCalls).toBe(0);
  });

  it("debounce: http.cancel during the pending window clears the timer and commits the originating episode", async () => {
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
          // The id an `emit` expression stamps on its record, so `kill` can name it.
          apply: (_l, p) => ({
            slots: { q: p.value as string },
            emits: [{ effect: "search", args: [{ q: p.value }], id: "search#1" }],
          }),
        },
        {
          name: "kill",
          event: { kind: "ui", ev: "click" },
          selector: { tile: "Kill" },
          apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["search#1"] }] }),
        },
      ],
    };
    const { logger, dispose, dispatch } = mountLogged(app);
    dispatch("onInput", { value: "kumiki" });
    expect(logger.list()).toEqual([]);
    dispatch("kill", {});
    // Past the original debounce window, so a launch that slipped through would show.
    await tick(70);

    const eps = logger.list();
    const inputEp = eps.find((ep) => ep.trigger.kind === "ui.input");
    expect(inputEp?.status).toBe("completed");
    // The policy cancel names the effect; the user's cancel names the full effect id.
    expect(cancels(inputEp!.steps)).toEqual([
      expect.objectContaining({ kind: "effect-cancel", targetId: "search" }),
    ]);
    const clickEp = eps.find((ep) => ep.trigger.kind === "ui.click");
    expect(cancels(clickEp!.steps)).toEqual([
      expect.objectContaining({ kind: "effect-cancel", targetId: "search#1" }),
    ]);
    dispose();
  });

  it("debounce: a missing capability at launch reports on the originating episode and releases its token", async () => {
    const app: AppShape = {
      slots: { q: { value: "" } },
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
    const errors = captureConsole();
    const { logger, dispose, dispatch } = mountLogged(app);
    dispatch("onInput", { value: "kumiki" });
    await tick(40);

    const eps = logger.list();
    expect(eps).toHaveLength(1);
    // `panic`, not `completed`: the refusal is what tells this apart from a replaced timer.
    expect(eps[0]!.status).toBe("panic");
    expect(eps[0]!.steps.map((s) => s.kind)).toEqual([
      "reducer",
      "effect-start",
      "signal-update",
      "panic",
      "effect-cancel",
    ]);
    expect(eps[0]!.steps.find((s) => s.kind === "panic")).toMatchObject({
      category: "capability",
      location: 'effect "search"',
      message: 'capability "http.get" is not declared in app.caps',
    });
    expect(errors).toEqual([
      '[kumiki] panic in effect "search": capability "http.get" is not declared in app.caps',
    ]);
    dispose();
  });
});
