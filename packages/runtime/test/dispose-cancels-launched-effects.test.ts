import type { AppShape, EffectResult, EffectSpec, Episode, MountedApp } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { recordingLogger } from "./helpers/episode-apps.ts";
import { tick } from "./helpers/time.ts";

const ABORTED_HTTP = { status: 0, message: "aborted", body: "" };

type Opts = {
  /** Answer the abort with the aborted `HttpError`, as `httpFetch` does. Default: ignore it. */
  honoursAbort?: boolean;
  withErrReducer?: boolean;
  policy?: EffectSpec["policy"];
  /** How many `load`s one `go` emits. Default: one. */
  loads?: number;
  /** Runs inside each `load`'s invoke, before it waits. */
  onInvoke?: () => void;
  onCommit?: (ep: Episode) => void;
};

/**
 * `go` emits `load` under `$el.id` when given, `stop` cancels `$el.id`, and `wait` emits `later`,
 * which waits out a 100ms debounce. Each `load` runs until the test answers it through `answer`,
 * unless `honoursAbort` lets its abort end it first. The result reducers record what reached them
 * in `results`. The app renders `ready`.
 */
function launchedApp(opts: Opts = {}) {
  const pending: ((r: EffectResult) => void)[] = [];
  const signals: AbortSignal[] = [];
  const results: string[] = [];
  const reducers: AppShape["reducers"] = [
    {
      name: "go",
      event: { kind: "ui", ev: "click" },
      apply: (_live, payload) => {
        const id = (payload.$el as { id?: string }).id;
        const load = { effect: "load", args: [null], ...(id ? { id } : {}) };
        return { slots: {}, emits: Array.from({ length: opts.loads ?? 1 }, () => load) };
      },
    },
    {
      name: "wait",
      event: { kind: "ui", ev: "click" },
      apply: () => ({ slots: {}, emits: [{ effect: "later", args: [null] }] }),
    },
    {
      name: "stop",
      event: { kind: "ui", ev: "click" },
      apply: (_live, payload) => ({
        slots: {},
        emits: [{ effect: "cancel", args: [(payload.$el as { id: string }).id] }],
      }),
    },
    {
      name: "onOk",
      event: { kind: "effect", effect: "load", outcome: "ok" },
      apply: (_live, payload) => {
        results.push(`ok ${JSON.stringify(payload.$1)}`);
        return { slots: {}, emits: [] };
      },
    },
  ];
  if (opts.withErrReducer !== false) {
    reducers.push({
      name: "onErr",
      event: { kind: "effect", effect: "load", outcome: "err" },
      apply: (_live, payload) => {
        results.push(`err ${JSON.stringify(payload.$1)}`);
        return { slots: {}, emits: [] };
      },
    });
  }
  const app: AppShape = {
    slots: {},
    caps: ["http.get", "http.cancel"],
    effects: {
      load: {
        name: "load",
        cap: "http.get",
        ...(opts.policy ? { policy: opts.policy } : {}),
        invoke: (_input, _caps, signal) =>
          new Promise<EffectResult>((resolve) => {
            opts.onInvoke?.();
            pending.push(resolve);
            if (signal) signals.push(signal);
            if (opts.honoursAbort) {
              signal?.addEventListener("abort", () =>
                resolve({ kind: "err", value: ABORTED_HTTP }),
              );
            }
          }),
      },
      later: {
        name: "later",
        cap: "http.get",
        policy: { kind: "debounce", ms: 100 },
        invoke: async () => ({ kind: "ok", value: null }),
      },
      cancel: {
        name: "cancel",
        cap: "http.cancel",
        invoke: async () => ({ kind: "ok", value: null }),
      },
    },
    init: [],
    reducers,
    root: () => ({ kind: "text", text: "ready" }),
  };
  const { logger, committed } = recordingLogger(opts.onCommit);
  const root = freshRoot();
  const handle = mount(app, root, { episodeLogger: logger });
  const dispatch = (name: string, el: Record<string, unknown> = {}): void =>
    (app as MountedApp)._dispatch(name, el);
  return {
    app,
    dispatch,
    dispose: handle.dispose,
    pending,
    answer: (r: EffectResult): void => {
      for (const resolve of pending) resolve(r);
    },
    signals,
    results,
    committed,
    steps: (): string[] => committed.flatMap((ep) => ep.steps.map((s) => s.kind)),
  };
}

const kinds = (ep: Episode | undefined): string[] => ep?.steps.map((s) => s.kind) ?? [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("disposing the app while an effect it launched is running", () => {
  it("records an effect-cancel on the episode that launched it, which commits before dispose returns", () => {
    const a = launchedApp();
    a.dispatch("go");
    expect(a.committed).toEqual([]);

    a.dispose();

    expect(a.committed).toHaveLength(1);
    expect(a.committed[0]?.status).toBe("completed");
    expect(a.committed[0]?.steps).toEqual([
      expect.objectContaining({ kind: "reducer", name: "go" }),
      expect.objectContaining({ kind: "effect-start", name: "load" }),
      expect.objectContaining({ kind: "effect-cancel", targetId: "load" }),
    ]);
  });

  it.each<[string, EffectResult]>([
    ["an ok", { kind: "ok", value: "late" }],
    ["an err", { kind: "err", value: { status: 503, message: "late", body: "" } }],
  ])("drops %s its invoke answers after dispose: no step, no reducer, nothing reported", async (_, late) => {
    const errors = captureConsole("error");
    const a = launchedApp({ withErrReducer: false });
    a.dispatch("go");
    a.dispose();
    const after = a.steps();

    a.answer(late);
    await tick(10);

    expect(a.results).toEqual([]);
    expect(a.committed).toHaveLength(1);
    expect(a.steps()).toEqual(after);
    expect(after).not.toContain("effect-end");
    expect(errors).toEqual([]);
  });

  it("aborts the invoke's signal, and the aborted err it answers with reaches no reducer", async () => {
    const a = launchedApp({ honoursAbort: true });
    a.dispatch("go");
    a.dispose();
    await tick(10);

    expect(a.signals.map((s) => s.aborted)).toEqual([true]);
    expect(a.results).toEqual([]);
    expect(a.steps()).toEqual(["reducer", "effect-start", "effect-cancel"]);
  });

  // `http.cancel` has aborted the request, but its aborted err is still on its way back.
  it("cancels a launch that a cancel aborted and that has not answered yet", async () => {
    const a = launchedApp({ honoursAbort: true });
    a.dispatch("go", { id: "load#a" });
    a.dispatch("stop", { id: "load#a" });
    a.dispose();

    const launched = a.committed.find((ep) => ep.steps.some((s) => s.kind === "effect-start"));
    expect(launched?.steps.map((s) => s.kind)).toEqual([
      "reducer",
      "effect-start",
      "effect-cancel",
    ]);
    await tick(10);
    expect(a.results).toEqual([]);
    expect(a.steps()).not.toContain("effect-end");
  });
});

describe("disposing the app with more than one effect to end", () => {
  it("ends every effect before it records a cancel, and each episode ends in its own", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const seen: { aborted: boolean[]; timers: number }[] = [];
    const a = launchedApp({
      onCommit: () =>
        seen.push({ aborted: a.signals.map((s) => s.aborted), timers: vi.getTimerCount() }),
    });
    a.dispatch("go");
    a.dispatch("go");
    a.dispatch("wait");
    expect(a.committed).toEqual([]);

    a.dispose();

    expect(seen).toEqual(Array.from({ length: 3 }, () => ({ aborted: [true, true], timers: 0 })));
    // `wait`'s debounced `later` is cancelled first, so its episode commits first; it is handed on
    // after the two `go`s, which began before it.
    expect(a.committed.map((ep) => ep.trigger.target)).toEqual(["go", "go", "wait"]);
    for (const ep of a.committed) {
      const started = ep.steps.find((s) => s.kind === "effect-start");
      expect(kinds(ep)).toEqual(["reducer", "effect-start", "effect-cancel"]);
      expect(ep.steps.at(-1)).toEqual(
        expect.objectContaining({
          kind: "effect-cancel",
          targetId: (started as { name: string }).name,
        }),
      );
    }
  });

  it.each<[string, EffectSpec["policy"]]>([
    ["the default policy", undefined],
    ["latest", { kind: "latest" }],
    ["latest-per-key", { kind: "latest-per-key", keyOf: () => "k" }],
    ["throttle", { kind: "throttle", ms: 1000 }],
    ["once", { kind: "once" }],
  ])("records one effect-cancel and no effect-end for a launch under %s", (_, policy) => {
    const a = launchedApp({ policy });
    a.dispatch("go");
    a.dispose();

    expect(a.committed).toHaveLength(1);
    expect(kinds(a.committed[0])).toEqual(["reducer", "effect-start", "effect-cancel"]);
  });

  it("still cancels the rest, and lets the shape mount again, when a commit throws", () => {
    let commits = 0;
    const a = launchedApp({
      onCommit: () => {
        commits++;
        if (commits === 1) throw new Error("host failed");
      },
    });
    a.dispatch("go");
    a.dispatch("go");

    expect(() => a.dispose()).toThrow("host failed");

    expect(a.committed.map(kinds)).toEqual([
      ["reducer", "effect-start", "effect-cancel"],
      ["reducer", "effect-start", "effect-cancel"],
    ]);
    const again = freshRoot();
    const handle = mount(a.app, again);
    expect(again.textContent).toBe("ready");
    a.dispatch("go");
    expect(a.pending).toHaveLength(3);
    handle.dispose();
  });
});

describe("disposing the app from inside the dispatch that launches an effect", () => {
  it("launches nothing the reducer emits after it, and the episode commits as the dispatch ends", async () => {
    const errors = captureConsole("error");
    let disposeNow = (): void => {};
    let disposing = true;
    const a = launchedApp({
      loads: 2,
      withErrReducer: false,
      onInvoke: () => {
        if (!disposing) return;
        disposing = false;
        disposeNow();
      },
    });
    disposeNow = a.dispose;

    a.dispatch("go");

    expect(a.pending).toHaveLength(1);
    expect(a.committed.map(kinds)).toEqual([["reducer", "effect-start", "effect-cancel"]]);
    a.answer({ kind: "err", value: { status: 503, message: "late", body: "" } });
    await tick(10);
    expect(a.results).toEqual([]);
    expect(a.steps()).not.toContain("effect-end");
    expect(errors).toEqual([]);
  });
});
