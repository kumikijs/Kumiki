import type {
  AppShape,
  EffectResult,
  EffectSpec,
  EpisodeLogger,
  ReducerSpec,
} from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { httpError } from "../src/effects-http.ts";
import { freshRoot } from "./helpers/dom.ts";
import { tick } from "./helpers/time.ts";

async function until(done: () => boolean, limitMs = 2000): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (!done() && Date.now() < deadline) await tick(5);
  // One more turn for the result to reach its .ok / .err reducer.
  await tick(10);
}

function makeApp(args: {
  retry?: AppShape["effects"][string]["retry"];
  responses: EffectResult[];
}): {
  app: AppShape;
  attempts: number;
  lastErr: { value: unknown } | null;
  lastOk: { value: unknown } | null;
} {
  let attempts = 0;
  const lastErr: { value: unknown } | null = { value: null };
  const lastOk: { value: unknown } | null = { value: null };
  const responses = [...args.responses];
  const app: AppShape = {
    slots: { count: { value: 0 } },
    caps: ["http.get"],
    effects: {
      load: {
        name: "load",
        cap: "http.get",
        ...(args.retry ? { retry: args.retry } : {}),
        invoke: async () => {
          attempts++;
          return responses.shift() ?? { kind: "err", value: { status: 0, message: "exhausted" } };
        },
      },
    },
    init: [{ effect: "load", args: [null] }],
    reducers: [
      {
        name: "onOk",
        event: { kind: "effect", effect: "load", outcome: "ok" },
        apply: (_live, payload) => {
          lastOk.value = payload.$1;
          return { slots: {}, emits: [] };
        },
      },
      {
        name: "onErr",
        event: { kind: "effect", effect: "load", outcome: "err" },
        apply: (_live, payload) => {
          lastErr.value = payload.$1;
          return { slots: {}, emits: [] };
        },
      },
    ],
  };
  return {
    app,
    get attempts() {
      return attempts;
    },
    lastErr,
    lastOk,
  };
}

describe("EffectSpec.retry", () => {
  it("retries 5xx until success (linear)", async () => {
    const state = makeApp({
      retry: { kind: "linear", n: 3, ms: 1 },
      responses: [
        { kind: "err", value: { status: 503, message: "x" } },
        { kind: "err", value: { status: 503, message: "x" } },
        { kind: "ok", value: { hello: "world" } },
      ],
    });
    const root = freshRoot();
    try {
      const { dispose } = mount(state.app, root);
      await until(() => state.attempts === 3);
      expect(state.attempts).toBe(3);
      expect(state.lastOk?.value).toEqual({ hello: "world" });
      expect(state.lastErr?.value).toBeNull();
      dispose();
    } finally {
      root.remove();
    }
  });

  it("does not retry 4xx; surfaces the err immediately", async () => {
    const state = makeApp({
      retry: { kind: "linear", n: 5, ms: 1 },
      responses: [{ kind: "err", value: { status: 404, message: "not found" } }],
    });
    const root = freshRoot();
    try {
      const { dispose } = mount(state.app, root);
      await tick(30);
      expect(state.attempts).toBe(1);
      expect((state.lastErr?.value as { status: number }).status).toBe(404);
      dispose();
    } finally {
      root.remove();
    }
  });

  it("retries connection errors (status 0) and surfaces final err after N attempts", async () => {
    const state = makeApp({
      retry: { kind: "exponential", n: 3, ms: 1, factor: 2 },
      responses: [
        { kind: "err", value: { status: 0, message: "net" } },
        { kind: "err", value: { status: 0, message: "net" } },
        { kind: "err", value: { status: 0, message: "net" } },
      ],
    });
    const root = freshRoot();
    try {
      const { dispose } = mount(state.app, root);
      await until(() => state.attempts === 3);
      expect(state.attempts).toBe(3);
      expect((state.lastErr?.value as { message: string }).message).toBe("net");
      dispose();
    } finally {
      root.remove();
    }
  });

  it("makes only one attempt when retry is undefined", async () => {
    const state = makeApp({
      responses: [{ kind: "err", value: { status: 500, message: "x" } }],
    });
    const root = freshRoot();
    try {
      const { dispose } = mount(state.app, root);
      await tick(30);
      expect(state.attempts).toBe(1);
      dispose();
    } finally {
      root.remove();
    }
  });
});

type BackoffOptions = {
  cap?: string;
  policy?: EffectSpec["policy"];
  retry: NonNullable<EffectSpec["retry"]>;
  fail?: unknown;
  errText?: EffectSpec["errText"];
  withErrReducer?: boolean;
  episodeLogger?: EpisodeLogger;
};

/**
 * `load` on `cap`, retrying with `retry`, whose every attempt fails with `fail` (a 503 unless
 * given) and is stamped with the clock's time. `go` emits `load($el.input)`, under `$el.id` when
 * given; `stop` cancels `$el.id`. Each `.err` lands in `errs`.
 */
function backoffApp(opts: BackoffOptions) {
  const cap = opts.cap ?? "http.get";
  const attempts: { at: number; input: unknown }[] = [];
  const errs: unknown[] = [];
  const reducers: ReducerSpec[] = [
    {
      name: "go",
      event: { kind: "ui", ev: "click" },
      apply: (_live, payload) => {
        const el = payload.$el as { input?: unknown; id?: string };
        const emit = { effect: "load", args: [el.input ?? null], ...(el.id ? { id: el.id } : {}) };
        return { slots: {}, emits: [emit] };
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
  ];
  if (opts.withErrReducer !== false) {
    reducers.push({
      name: "onErr",
      event: { kind: "effect", effect: "load", outcome: "err" },
      apply: (_live, payload) => {
        errs.push(payload.$1);
        return { slots: {}, emits: [] };
      },
    });
  }
  const app: AppShape = {
    slots: {},
    caps: [cap, "http.cancel"],
    effects: {
      load: {
        name: "load",
        cap,
        retry: opts.retry,
        ...(opts.policy ? { policy: opts.policy } : {}),
        ...(opts.errText ? { errText: opts.errText } : {}),
        invoke: async (input) => {
          attempts.push({ at: Date.now(), input });
          return { kind: "err", value: opts.fail ?? httpError(503, "busy") };
        },
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
  const root = freshRoot();
  const handle = mount(app, root, opts.episodeLogger ? { episodeLogger: opts.episodeLogger } : {});
  const dispatch = (reducer: string, el: Record<string, unknown> = {}): void =>
    (app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void })._dispatch(
      reducer,
      el,
    );
  const dispose = (): void => {
    handle.dispose();
    root.remove();
  };
  return { attempts, errs, dispatch, dispose };
}

const ABORTED_HTTP = httpError(0, "aborted");

describe("a request waiting between retry attempts", () => {
  let disposeApp: (() => void) | undefined;
  const open = (opts: BackoffOptions) => {
    const a = backoffApp(opts);
    disposeApp = a.dispose;
    return a;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    disposeApp?.();
    disposeApp = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("makes no attempt 499 ms into a 500 ms wait, and the next one at 500 ms", async () => {
    const a = open({ retry: { kind: "linear", n: 2, ms: 500 } });
    a.dispatch("go");
    await vi.advanceTimersByTimeAsync(0);
    expect(a.attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(a.attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.attempts).toHaveLength(2);
    expect((a.attempts[1]?.at ?? 0) - (a.attempts[0]?.at ?? 0)).toBe(500);
  });

  it("ends at a cancel during the second wait, delivering the aborted err once", async () => {
    const a = open({ retry: { kind: "linear", n: 3, ms: 500 } });
    a.dispatch("go", { id: "load#a" });
    await vi.advanceTimersByTimeAsync(500);
    expect(a.attempts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    a.dispatch("stop", { id: "load#a" });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.errs).toEqual([ABORTED_HTTP]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(a.attempts).toHaveLength(2);
    expect(a.errs).toEqual([ABORTED_HTTP]);
  });

  it("under latest-per-key, ends at a newer emit for its own key and not another key's", async () => {
    const a = open({
      policy: { kind: "latest-per-key", keyOf: (input) => String(input) },
      retry: { kind: "linear", n: 2, ms: 500 },
    });
    a.dispatch("go", { input: "a" });
    a.dispatch("go", { input: "b" });
    await vi.advanceTimersByTimeAsync(100);
    expect(a.errs).toEqual([]);

    a.dispatch("go", { input: "a" });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.errs).toEqual([ABORTED_HTTP]);

    await vi.advanceTimersByTimeAsync(400);
    const bAt = a.attempts.filter((x) => x.input === "b").map((x) => x.at);
    expect(bAt).toHaveLength(2);
    expect((bAt[1] ?? 0) - (bAt[0] ?? 0)).toBe(500);
  });

  it.each<[string, Partial<BackoffOptions>, unknown]>([
    ["an http.* capability", {}, ABORTED_HTTP],
    [
      "a capability that fails with Text",
      {
        cap: "storage.read",
        fail: "blocked",
        errText: (v) => (typeof v === "string" ? v : (v as { message: string }).message),
      },
      "aborted",
    ],
    [
      "any other capability",
      { cap: "geo.read", fail: { reason: "denied" } },
      { message: "aborted" },
    ],
  ])("delivers, on %s, the aborted err that capability's .err reads", async (_, extra, want) => {
    const a = open({
      policy: { kind: "latest" },
      retry: { kind: "linear", n: 2, ms: 500 },
      ...extra,
    });
    a.dispatch("go");
    await vi.advanceTimersByTimeAsync(100);
    a.dispatch("go");
    await vi.advanceTimersByTimeAsync(0);
    expect(a.errs).toEqual([want]);
  });

  it("ends at unmount, with no further attempt and nothing reported", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = open({ retry: { kind: "linear", n: 2, ms: 500 }, withErrReducer: false });
    a.dispatch("go");
    await vi.advanceTimersByTimeAsync(100);
    a.dispose();
    disposeApp = undefined;
    await vi.advanceTimersByTimeAsync(2000);
    expect(a.attempts).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
  });

  // What #942 leaves: the end is still recorded once the app is unmounted, as it is for a request
  // in flight at unmount, but no reducer receives it.
  it("records its aborted end at unmount, which no .err reducer receives", async () => {
    const logger = createEpisodeLogger();
    const a = open({ retry: { kind: "linear", n: 2, ms: 500 }, episodeLogger: logger });
    a.dispatch("go");
    await vi.advanceTimersByTimeAsync(100);
    a.dispose();
    disposeApp = undefined;
    await vi.advanceTimersByTimeAsync(0);
    expect(a.errs).toEqual([]);
    const steps = logger.list().flatMap((ep) => ep.steps);
    expect(steps.at(-1)).toMatchObject({ kind: "effect-end", result: "err", value: ABORTED_HTTP });
    expect(steps.filter((st) => st.kind === "reducer")).toHaveLength(1);
  });
});
