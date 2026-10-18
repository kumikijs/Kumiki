import type { AppShape, EffectResult, Episode, MountedApp } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { tick } from "./helpers/time.ts";

const ABORTED_HTTP = { status: 0, message: "aborted", body: "" };

type Opts = {
  /** Answer the abort with the aborted `HttpError`, as `httpFetch` does. Default: ignore it. */
  honoursAbort?: boolean;
  withErrReducer?: boolean;
  logged?: boolean;
};

/**
 * `go` emits `load` under `$el.id` when given, and `stop` cancels `$el.id`. Each `load` runs
 * until the test answers it through `answer`, unless `honoursAbort` lets its abort end it first.
 * The result reducers record what reached them in `results`.
 */
function launchedApp(opts: Opts = {}) {
  const pending: ((r: EffectResult) => void)[] = [];
  const signals: AbortSignal[] = [];
  const results: string[] = [];
  const committed: Episode[] = [];
  const reducers: AppShape["reducers"] = [
    {
      name: "go",
      event: { kind: "ui", ev: "click" },
      apply: (_live, payload) => {
        const id = (payload.$el as { id?: string }).id;
        return { slots: {}, emits: [{ effect: "load", args: [null], ...(id ? { id } : {}) }] };
      },
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
        invoke: (_input, _caps, signal) =>
          new Promise<EffectResult>((resolve) => {
            pending.push(resolve);
            if (signal) signals.push(signal);
            if (opts.honoursAbort) {
              signal?.addEventListener("abort", () =>
                resolve({ kind: "err", value: ABORTED_HTTP }),
              );
            }
          }),
      },
      cancel: {
        name: "cancel",
        cap: "http.cancel",
        invoke: async () => ({ kind: "ok", value: null }),
      },
    },
    init: [],
    reducers,
  };
  const logger = createEpisodeLogger({ onEpisode: (ep) => committed.push(ep) });
  const root = freshRoot();
  const handle = mount(app, root, opts.logged === false ? {} : { episodeLogger: logger });
  const dispatch = (name: string, el: Record<string, unknown> = {}): void =>
    (app as MountedApp)._dispatch(name, el);
  return {
    dispatch,
    dispose: handle.dispose,
    answer: (r: EffectResult): void => {
      for (const resolve of pending) resolve(r);
    },
    signals,
    results,
    committed,
    steps: (): string[] => committed.flatMap((ep) => ep.steps.map((s) => s.kind)),
  };
}

afterEach(() => {
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

  it("with no episode logger, still delivers nothing after dispose", async () => {
    const errors = captureConsole("error");
    const a = launchedApp({ logged: false, withErrReducer: false });
    a.dispatch("go");
    a.dispose();
    a.answer({ kind: "err", value: { status: 503, message: "late", body: "" } });
    await tick(10);

    expect(a.results).toEqual([]);
    expect(errors).toEqual([]);
  });
});
