// Coverage for issue #102 — `http.cancel` capability + `EffectId` returned at
// `emit` time. Verifies the dispatcher's special-case `http.cancel` branch:
// the in-flight controller is aborted (so `httpFetch`'s fetch sees the abort
// and resolves to `{status:0, message:"aborted"}`), pending debounce timers
// are cleared, unknown ids are silent no-ops, and the Episode logger records
// the cancel when it released something.

import type { AppShape, EffectResult, EffectSpec, EmitSpec } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { emitId } from "../src/core.ts";

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

type AbortLog = { aborted: boolean; signal?: AbortSignal | undefined };

function makeCancelApp(): {
  app: AppShape;
  log: AbortLog;
  lastErr: { value: unknown } | null;
  lastOk: { value: unknown } | null;
  resolveNext: () => void;
} {
  const log: AbortLog = { aborted: false };
  const lastErr: { value: unknown } | null = { value: null };
  const lastOk: { value: unknown } | null = { value: null };
  let resolveFetch: (r: EffectResult) => void = () => {};
  const resolveNext = (): void => resolveFetch({ kind: "ok", value: { hi: "world" } });
  const app: AppShape = {
    slots: { state: { value: "idle" }, id: { value: "" } },
    caps: ["http.get", "http.cancel"],
    effects: {
      search: {
        name: "search",
        cap: "http.get",
        policy: { kind: "latest" },
        invoke: (_input, _caps, signal) =>
          new Promise<EffectResult>((resolve) => {
            log.signal = signal;
            resolveFetch = resolve;
            // §6.4.1: when the dispatcher aborts the signal we mirror what
            // `httpFetch` would actually return — `{status:0, message:"aborted"}` —
            // so the rest of the pipeline (.err reducer, no-silent-failure
            // contract) sees the production shape.
            signal?.addEventListener("abort", () => {
              log.aborted = true;
              resolve({ kind: "err", value: { status: 0, message: "aborted", body: "" } });
            });
          }),
      },
      cancel: {
        name: "cancel",
        cap: "http.cancel",
        // Dispatcher never calls invoke for cap=http.cancel — kept for shape.
        invoke: async () => ({ kind: "ok", value: null }),
      },
    },
    init: [],
    reducers: [
      {
        name: "go",
        event: { kind: "ui", ev: "click" },
        selector: { tile: "Go" },
        apply: () => ({ slots: {}, emits: [{ effect: "search", args: [{ url: "/q" }] }] }),
      },
      {
        name: "kill",
        event: { kind: "ui", ev: "click" },
        selector: { tile: "Kill" },
        apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["search:_"] }] }),
      },
      {
        name: "killGhost",
        event: { kind: "ui", ev: "click" },
        selector: { tile: "KillGhost" },
        apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["unknown:id"] }] }),
      },
      {
        name: "onOk",
        event: { kind: "effect", effect: "search", outcome: "ok" },
        apply: (_live, payload) => {
          lastOk.value = payload.$1;
          return { slots: { state: "loaded" }, emits: [] };
        },
      },
      {
        name: "onErr",
        event: { kind: "effect", effect: "search", outcome: "err" },
        apply: (_live, payload) => {
          lastErr.value = payload.$1;
          return { slots: { state: "failed" }, emits: [] };
        },
      },
    ],
  };
  return { app, log, lastErr, lastOk, resolveNext };
}

describe("dispatcher http.cancel (#102)", () => {
  it("aborts an in-flight effect and surfaces aborted to the .err reducer", async () => {
    const { app, log, lastErr } = makeCancelApp();
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      // The search effect is `policy=latest` so the dispatcher creates a
      // controller and stores it under `search:_`.
      dispatch("go", {});
      await tick();
      expect(log.signal).toBeDefined();
      expect(log.aborted).toBe(false);

      dispatch("kill", {});
      await tick(20);
      expect(log.aborted).toBe(true);
      expect(lastErr?.value).toMatchObject({ status: 0, message: "aborted", body: "" });
      dispose();
    } finally {
      root.remove();
    }
  });

  it("is a silent no-op for an unknown effect id (no throw, no .err)", async () => {
    const { app, lastErr } = makeCancelApp();
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("killGhost", {});
      await tick(10);
      // No in-flight effect → cancel must not surface a spurious `.err`.
      expect(lastErr?.value).toBeNull();
      dispose();
    } finally {
      root.remove();
    }
  });

  it("does NOT clear a throttle window on cancel (review fix)", async () => {
    // spec §6.4.1: a throttle window marker stays put on cancel so a next
    // emit within the window does not slip past the rate limit.
    let calls = 0;
    const app: AppShape = {
      slots: { last: { value: "" } },
      caps: ["http.get", "http.cancel"],
      effects: {
        ping: {
          name: "ping",
          cap: "http.get",
          policy: { kind: "throttle", ms: 100 },
          invoke: async () => {
            calls++;
            return { kind: "ok", value: "pong" };
          },
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
          name: "fire",
          event: { kind: "ui", ev: "click" },
          selector: { tile: "Fire" },
          // The id this emit yields, as a reducer body's `emit` expression
          // stamps it, so `kill` names the request the window was opened for.
          apply: () => ({
            slots: {},
            emits: [{ effect: "ping", args: [{ url: "/p" }], id: "ping#1" }],
          }),
        },
        {
          name: "kill",
          event: { kind: "ui", ev: "click" },
          selector: { tile: "Kill" },
          apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["ping#1"] }] }),
        },
        {
          name: "onOk",
          event: { kind: "effect", effect: "ping", outcome: "ok" },
          apply: (_l, p) => ({ slots: { last: p.$1 }, emits: [] }),
        },
      ],
    };
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("fire", {});
      await tick(5);
      // First call launches (throttle window opens).
      expect(calls).toBe(1);
      dispatch("kill", {});
      await tick(5);
      // Cancel does NOT reset the throttle marker, so a second emit inside the
      // window is suppressed.
      dispatch("fire", {});
      await tick(10);
      expect(calls).toBe(1);
      dispose();
    } finally {
      root.remove();
    }
  });

  it("records an effect-cancel step in the episode logger", async () => {
    const { app } = makeCancelApp();
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root, { episodeLogger: logger });
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("go", {});
      await tick();
      dispatch("kill", {});
      await tick(20);
      const cancelSteps = logger
        .list()
        .flatMap((ep) => ep.steps)
        .filter((s) => s.kind === "effect-cancel");
      expect(cancelSteps.length).toBeGreaterThan(0);
      expect(cancelSteps[0]).toMatchObject({ kind: "effect-cancel", targetId: "search:_" });
      dispose();
    } finally {
      root.remove();
    }
  });
});

describe("the effect-cancel step an http.cancel records (runtime.md §10.5.1)", () => {
  // One effect per kind of release the cancel branch can match. All but
  // `retried` hold their request open until the test resolves it or the
  // signal aborts.
  // `start` emits under the id the test names, the way a reducer body's `emit`
  // expression stamps the id it yielded; `kill` cancels the id the test names.
  type Held = { resolve: (r: EffectResult) => void; signal?: AbortSignal | undefined };
  function makeApp(): { app: AppShape; held: Record<string, Held[]> } {
    const held: Record<string, Held[]> = { req: [], queued: [], deb: [], thr: [], retried: [] };
    const hold =
      (name: string): EffectSpec["invoke"] =>
      (_input, _caps, signal) =>
        new Promise<EffectResult>((resolve) => {
          held[name]?.push({ resolve, signal });
          signal?.addEventListener("abort", () =>
            resolve({ kind: "err", value: { status: 0, message: "aborted", body: "" } }),
          );
        });
    const quiet = (effect: string, outcome: "ok" | "err") => ({
      name: `${effect}_${outcome}`,
      event: { kind: "effect" as const, effect, outcome },
      apply: () => ({ slots: {}, emits: [] }),
    });
    const app: AppShape = {
      slots: {},
      caps: ["http.get", "http.cancel"],
      effects: {
        req: { name: "req", cap: "http.get", invoke: hold("req") },
        queued: {
          name: "queued",
          cap: "http.get",
          policy: { kind: "queue" },
          invoke: hold("queued"),
        },
        deb: {
          name: "deb",
          cap: "http.get",
          policy: { kind: "debounce", ms: 1000 },
          invoke: hold("deb"),
        },
        thr: {
          name: "thr",
          cap: "http.get",
          policy: { kind: "throttle", ms: 1000 },
          invoke: hold("thr"),
        },
        // Every attempt fails with a status that retries, so after the first
        // one the request waits 40ms for the next.
        retried: {
          name: "retried",
          cap: "http.get",
          retry: { kind: "linear", n: 3, ms: 40 },
          invoke: async (_input, _caps, signal) => {
            held.retried?.push({ resolve: () => {}, signal });
            return { kind: "err", value: { status: 503, message: "unavailable", body: "" } };
          },
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
          name: "start",
          event: { kind: "ui", ev: "click" },
          selector: { tile: "Start" },
          apply: (_l, p) => {
            const ev = p.$event as { effect: string; id: string };
            return { slots: {}, emits: [{ effect: ev.effect, args: [{}], id: ev.id }] };
          },
        },
        {
          name: "kill",
          event: { kind: "ui", ev: "click" },
          selector: { tile: "Kill" },
          apply: (_l, p) => ({
            slots: {},
            emits: [{ effect: "cancel", args: [(p.$event as { target: string }).target] }],
          }),
        },
        ...["req", "queued", "deb", "thr", "retried"].flatMap((e) => [
          quiet(e, "ok"),
          quiet(e, "err"),
        ]),
      ],
    };
    return { app, held };
  }

  async function withApp(
    body: (ctx: {
      start: (effect: string, id: string) => void;
      kill: (target: string) => void;
      held: Record<string, Held[]>;
      logger: ReturnType<typeof createEpisodeLogger>;
    }) => Promise<void>,
  ): Promise<void> {
    const { app, held } = makeApp();
    const logger = createEpisodeLogger({ memoryMax: 50 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root, { episodeLogger: logger });
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      await body({
        start: (effect, id) => dispatch("start", { effect, id }),
        kill: (target) => dispatch("kill", { target }),
        held,
        logger,
      });
      dispose();
    } finally {
      root.remove();
    }
  }

  // The steps of the episode the cancel was emitted on, read once it has
  // committed. Its reducer step says the cancel was emitted, whether or not
  // anything matched — so a test that finds no `effect-cancel` here has found
  // the episode that would carry it.
  function killEpisode(logger: ReturnType<typeof createEpisodeLogger>): {
    emits: string[];
    cancels: unknown[];
  } {
    const eps = logger
      .list()
      .filter((ep) => ep.steps.some((s) => s.kind === "reducer" && s.name === "kill"));
    expect(eps).toHaveLength(1);
    const steps = eps[0]?.steps ?? [];
    const reducer = steps.find((s) => s.kind === "reducer");
    return {
      emits: reducer?.kind === "reducer" ? reducer.emits : [],
      cancels: steps.filter((s) => s.kind === "effect-cancel"),
    };
  }

  const allCancels = (logger: ReturnType<typeof createEpisodeLogger>): unknown[] =>
    logger
      .list()
      .flatMap((ep) => ep.steps)
      .filter((s) => s.kind === "effect-cancel");

  it("a cancel that aborts a request in flight records the id it aborted", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("req", "req#1");
      await tick();
      kill("req#1");
      await tick();
      expect(held.req?.[0]?.signal?.aborted).toBe(true);
      expect(killEpisode(logger).cancels).toEqual([
        { kind: "effect-cancel", targetId: "req#1", ts: expect.any(Number) },
      ]);
    });
  });

  it("a cancel of an id no request runs under records no effect-cancel, and the one in flight runs on", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("req", "req#1");
      await tick();
      kill("req#2");
      await tick();
      expect(held.req?.[0]?.signal?.aborted).toBe(false);
      expect(killEpisode(logger)).toEqual({ emits: ["cancel"], cancels: [] });
      expect(allCancels(logger)).toEqual([]);
    });
  });

  it("a cancel while a request waits between retry attempts records its id", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("retried", "retried#1");
      await tick();
      expect(held.retried).toHaveLength(1);
      kill("retried#1");
      // Past the wait, so the request has delivered its result.
      await tick(80);
      expect(held.retried?.[0]?.signal?.aborted).toBe(true);
      expect(killEpisode(logger).cancels).toEqual([
        { kind: "effect-cancel", targetId: "retried#1", ts: expect.any(Number) },
      ]);
    });
  });

  it("a cancel of a request that already completed records no effect-cancel", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("req", "req#1");
      await tick();
      held.req?.[0]?.resolve({ kind: "ok", value: "done" });
      await tick();
      kill("req#1");
      await tick();
      expect(killEpisode(logger)).toEqual({ emits: ["cancel"], cancels: [] });
      expect(allCancels(logger)).toEqual([]);
    });
  });

  it("a cancel of EffectId.none records no effect-cancel", async () => {
    await withApp(async ({ start, kill, logger }) => {
      start("req", "req#1");
      await tick();
      kill("");
      await tick();
      expect(killEpisode(logger)).toEqual({ emits: ["cancel"], cancels: [] });
    });
  });

  it("a cancel that removes a queue entry still waiting records its id, and the running entry runs on", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("queued", "queued#1");
      start("queued", "queued#2");
      await tick();
      expect(held.queued).toHaveLength(1);
      kill("queued#2");
      await tick();
      expect(held.queued?.[0]?.signal?.aborted).toBe(false);
      expect(killEpisode(logger).cancels).toEqual([
        { kind: "effect-cancel", targetId: "queued#2", ts: expect.any(Number) },
      ]);
      // The episode that emitted the released entry records its own release,
      // by effect name, and commits.
      const owner = logger
        .list()
        .find((ep) => ep.steps.some((s) => s.kind === "effect-start" && s.name === "queued"));
      expect(owner?.steps.filter((s) => s.kind === "effect-cancel")).toEqual([
        { kind: "effect-cancel", targetId: "queued", ts: expect.any(Number) },
      ]);
    });
  });

  it("a cancel that clears a pending debounce timer records its id", async () => {
    await withApp(async ({ start, kill, logger }) => {
      start("deb", "deb#1");
      kill("deb#1");
      await tick();
      expect(killEpisode(logger).cancels).toEqual([
        { kind: "effect-cancel", targetId: "deb#1", ts: expect.any(Number) },
      ]);
    });
  });

  it("a cancel of a debounce emit a later one replaced records no effect-cancel, and the later one stays pending", async () => {
    await withApp(async ({ start, kill, logger }) => {
      start("deb", "deb#1");
      start("deb", "deb#2");
      kill("deb#1");
      await tick();
      expect(killEpisode(logger)).toEqual({ emits: ["cancel"], cancels: [] });
      // The replace itself released `deb#1`'s claim on its own episode.
      expect(allCancels(logger)).toEqual([
        { kind: "effect-cancel", targetId: "deb", ts: expect.any(Number) },
      ]);
      // `deb#2` is still waiting on its timer: cancelling it releases it.
      kill("deb#2");
      await tick();
      const killEps = logger
        .list()
        .filter((ep) => ep.steps.some((s) => s.kind === "reducer" && s.name === "kill"));
      expect(killEps.map((ep) => ep.steps.filter((s) => s.kind === "effect-cancel"))).toEqual([
        [],
        [{ kind: "effect-cancel", targetId: "deb#2", ts: expect.any(Number) }],
      ]);
    });
  });

  it("a cancel that finds only a throttle window open records no effect-cancel, and the window stays", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("thr", "thr#1");
      await tick();
      held.thr?.[0]?.resolve({ kind: "ok", value: "done" });
      await tick();
      kill("thr#1");
      await tick();
      expect(killEpisode(logger)).toEqual({ emits: ["cancel"], cancels: [] });
      // The window is the effect's, not a pending launch: it still holds.
      start("thr", "thr#2");
      await tick();
      expect(held.thr).toHaveLength(1);
    });
  });

  it("a cancel of a throttled request still in flight records its id", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("thr", "thr#1");
      await tick();
      kill("thr#1");
      await tick();
      expect(held.thr?.[0]?.signal?.aborted).toBe(true);
      expect(killEpisode(logger).cancels).toEqual([
        { kind: "effect-cancel", targetId: "thr#1", ts: expect.any(Number) },
      ]);
    });
  });
});

describe("a latest-per-key emit that carries its key (http.md §6.4)", () => {
  // The reducer writes the slot the key reads *after* emitting, so the key the
  // emit carries ("a") and the one `keyOf` would read from the committed slots
  // ("b") differ. The request is registered under the carried key.
  function makeKeyedApp(emitted: { effect: string; args: unknown[]; key?: string }): {
    app: AppShape;
    log: AbortLog;
  } {
    const log: AbortLog = { aborted: false };
    const app: AppShape = {
      slots: { noteKey: { value: "a" } },
      caps: ["http.get", "http.cancel"],
      effects: {
        load: {
          name: "load",
          cap: "http.get",
          policy: { kind: "latest-per-key", keyOf: () => String(app.live?.noteKey) },
          invoke: (_input, _caps, signal) =>
            new Promise<EffectResult>((resolve) => {
              log.signal = signal;
              signal?.addEventListener("abort", () => {
                log.aborted = true;
                resolve({ kind: "err", value: { status: 0, message: "aborted", body: "" } });
              });
            }),
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
          name: "go",
          event: { kind: "ui", ev: "click" },
          selector: { tile: "Go" },
          apply: () => ({ slots: { noteKey: "b" }, emits: [emitted] }),
        },
        {
          name: "killA",
          event: { kind: "ui", ev: "click" },
          selector: { tile: "KillA" },
          apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["load:a"] }] }),
        },
        {
          name: "killB",
          event: { kind: "ui", ev: "click" },
          selector: { tile: "KillB" },
          apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["load:b"] }] }),
        },
      ],
    };
    return { app, log };
  }

  async function run(
    emitted: { effect: string; args: unknown[]; key?: string },
    kill: "killA" | "killB",
  ): Promise<boolean> {
    const { app, log } = makeKeyedApp(emitted);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("go", {});
      await tick();
      expect(log.signal).toBeDefined();
      dispatch(kill, {});
      await tick(20);
      // Read before `dispose()`, which aborts whatever is still in flight.
      const aborted = log.aborted;
      dispose();
      return aborted;
    } finally {
      root.remove();
    }
  }

  it("registers the request under the carried key, not the one keyOf reads", async () => {
    expect(await run({ effect: "load", args: ["x"], key: "a" }, "killA")).toBe(true);
  });

  it("falls back to keyOf against the live slots when the emit carries no key", async () => {
    expect(await run({ effect: "load", args: ["x"] }, "killB")).toBe(true);
  });
});

describe("the EffectId an emit yields (http.md §6.4)", () => {
  type Policy = EffectSpec["policy"];
  const idOf = (policy: Policy, emit: EmitSpec): string => emitId(policy ? { policy } : {}, emit);

  it.each([
    ["no policy", undefined],
    ["queue", { kind: "queue" }],
    ["once", { kind: "once" }],
    ["debounce", { kind: "debounce", ms: 5 }],
    ["throttle", { kind: "throttle", ms: 5 }],
  ] as [string, Policy][])("%s: one id per emit, and the one an emit carries", (_l, policy) => {
    const a = idOf(policy, { effect: "up", args: ["x"] });
    expect(idOf(policy, { effect: "up", args: ["x"] })).not.toBe(a);
    // What a reducer body's `emit` expression yielded is on the record, and the
    // dispatcher asks again: the answer is that id.
    expect(idOf(policy, { effect: "up", args: ["x"], id: a })).toBe(a);
  });

  it("latest: every emit of the effect yields the id of the one request it runs", () => {
    const policy: Policy = { kind: "latest" };
    expect(idOf(policy, { effect: "up", args: ["x"] })).toBe(
      idOf(policy, { effect: "up", args: ["y"] }),
    );
  });

  it("latest-per-key: emits under one key share an id, and two keys have two", () => {
    const policy: Policy = { kind: "latest-per-key", keyOf: (input) => String(input) };
    const x = idOf(policy, { effect: "up", args: ["x"] });
    expect(idOf(policy, { effect: "up", args: ["x"] })).toBe(x);
    expect(idOf(policy, { effect: "up", args: ["y"] })).not.toBe(x);
    // The key the emit carries wins over the one `keyOf` reads.
    expect(idOf(policy, { effect: "up", args: ["y"], key: "x" })).toBe(x);
  });
});
