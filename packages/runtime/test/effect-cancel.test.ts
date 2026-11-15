import type {
  AppShape,
  EffectResult,
  EffectSpec,
  EmitSpec,
  EpisodeLogger,
  EpisodeStep,
  ReducerSpec,
} from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { emitId, withEnvRecord, withEnvReplay } from "../src/core.ts";
import { httpError } from "../src/effects-http.ts";
import { _stdlibCore } from "../src/stdlib.ts";
import { freshRoot } from "./helpers/dom.ts";
import { mountLogged } from "./helpers/episode-apps.ts";
import { tick } from "./helpers/time.ts";

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
            signal?.addEventListener("abort", () => {
              log.aborted = true;
              resolve({ kind: "err", value: httpError(0, "aborted") });
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

describe("dispatcher http.cancel", () => {
  it("aborts an in-flight effect and surfaces aborted to the .err reducer", async () => {
    const { app, log, lastErr } = makeCancelApp();
    const root = freshRoot();
    try {
      const { dispose } = mount(app, root);
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("go", {});
      await tick(5);
      expect(log.signal).toBeDefined();
      expect(log.aborted).toBe(false);

      dispatch("kill", {});
      await tick(20);
      expect(log.aborted).toBe(true);
      expect(lastErr?.value).toEqual({ status: 0, message: "aborted", body: { _tag: "None" } });
      dispose();
    } finally {
      root.remove();
    }
  });

  it("is a silent no-op for an unknown effect id (no throw, no .err)", async () => {
    const { app, lastErr } = makeCancelApp();
    const root = freshRoot();
    try {
      const { dispose } = mount(app, root);
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("killGhost", {});
      await tick(10);
      expect(lastErr?.value).toBeNull();
      dispose();
    } finally {
      root.remove();
    }
  });

  it("does NOT clear a throttle window on cancel", async () => {
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
          // The id an `emit` expression stamps on its record, so `kill` names this request.
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
    const root = freshRoot();
    try {
      const { dispose } = mount(app, root);
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("fire", {});
      await tick(5);
      expect(calls).toBe(1);
      dispatch("kill", {});
      await tick(5);
      // Cancel leaves the throttle window open, so a second emit inside it is suppressed.
      dispatch("fire", {});
      await tick(10);
      expect(calls).toBe(1);
      dispose();
    } finally {
      root.remove();
    }
  });

  it("records an effect-cancel step in the episode logger when it aborts a request in flight", async () => {
    const { app } = makeCancelApp();
    const { logger, dispatch, dispose } = mountLogged(app);
    try {
      dispatch("go", {});
      await tick(5);
      dispatch("kill", {});
      await tick(20);
      const cancelSteps = logger
        .list()
        .flatMap((ep) => ep.steps)
        .filter((s) => s.kind === "effect-cancel");
      expect(cancelSteps).toEqual([
        { kind: "effect-cancel", targetId: "search:_", ts: expect.any(Number) },
      ]);
    } finally {
      dispose();
    }
  });
});

describe("the effect-cancel step an http.cancel records", () => {
  // One effect per state a cancel can find its id in. `start` emits under the id the test names,
  // as an `emit` expression stamps it; `kill` cancels the id the test names; `startAndKill` does
  // both in one body. `own`'s `.ok` and `.err` reducers cancel the id its result carries.
  type Held = { resolve: (r: EffectResult) => void; signal?: AbortSignal | undefined };
  const ABORTED = { status: 0, message: "aborted", body: { _tag: "None" } };
  function makeApp(): { app: AppShape; held: Record<string, Held[]> } {
    const held: Record<string, Held[]> = {
      req: [],
      own: [],
      queued: [],
      deb: [],
      thr: [],
      once: [],
      retried: [],
    };
    const hold =
      (name: string): EffectSpec["invoke"] =>
      (_input, _caps, signal) =>
        new Promise<EffectResult>((resolve) => {
          held[name]?.push({ resolve, signal });
          signal?.addEventListener("abort", () => resolve({ kind: "err", value: ABORTED }));
        });
    const quiet = (effect: string, outcome: "ok" | "err"): ReducerSpec => ({
      name: `${effect}_${outcome}`,
      event: { kind: "effect", effect, outcome },
      apply: () => ({ slots: {}, emits: [] }),
    });
    const cancelOwn = (outcome: "ok" | "err"): ReducerSpec => ({
      name: `own_${outcome}`,
      event: { kind: "effect", effect: "own", outcome },
      apply: (_l, p) => ({
        slots: {},
        emits: [{ effect: "cancel", args: [p.$1] }],
      }),
    });
    type Ev = { effect: string; id: string; target: string };
    const click = (name: string, tile: string, emits: (ev: Ev) => EmitSpec[]): ReducerSpec => ({
      name,
      event: { kind: "ui", ev: "click" },
      selector: { tile },
      apply: (_l, p) => ({
        slots: {},
        emits: emits(p.$event as Ev),
      }),
    });
    const app: AppShape = {
      slots: {},
      caps: ["http.get", "http.cancel"],
      effects: {
        req: { name: "req", cap: "http.get", invoke: hold("req") },
        own: { name: "own", cap: "http.get", invoke: hold("own") },
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
        once: { name: "once", cap: "http.get", policy: { kind: "once" }, invoke: hold("once") },
        // Every attempt fails with a status that retries, so after the first
        // one the request waits 40ms for the next.
        retried: {
          name: "retried",
          cap: "http.get",
          retry: { kind: "linear", n: 3, ms: 40 },
          invoke: async (_input, _caps, signal) => {
            held.retried?.push({ resolve: () => {}, signal });
            return {
              kind: "err",
              value: { status: 503, message: "unavailable", body: { _tag: "Some", _0: "" } },
            };
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
        click("start", "Start", (ev) => [{ effect: ev.effect, args: [{}], id: ev.id }]),
        click("kill", "Kill", (ev) => [{ effect: "cancel", args: [ev.target] }]),
        click("startAndKill", "StartAndKill", (ev) => [
          { effect: ev.effect, args: [{}], id: ev.id },
          { effect: "cancel", args: [ev.id] },
        ]),
        cancelOwn("ok"),
        cancelOwn("err"),
        ...["req", "queued", "deb", "thr", "once", "retried"].flatMap((e) => [
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
      startAndKill: (effect: string, id: string) => void;
      held: Record<string, Held[]>;
      logger: EpisodeLogger;
    }) => Promise<void>,
  ): Promise<void> {
    const { app, held } = makeApp();
    const { logger, dispatch, dispose } = mountLogged(app, 50);
    try {
      await body({
        start: (effect, id) => dispatch("start", { effect, id }),
        kill: (target) => dispatch("kill", { target }),
        startAndKill: (effect, id) => dispatch("startAndKill", { effect, id }),
        held,
        logger,
      });
    } finally {
      dispose();
    }
  }

  // An episode is found by its reducer step, which is there whether or not the cancel matched, so
  // an empty `cancels` is a real absence, not a missed lookup.
  function episodeOf(
    logger: EpisodeLogger,
    reducer: string,
  ): { emits: string[]; cancels: EpisodeStep[]; ends: EpisodeStep[] } {
    const eps = logger
      .list()
      .filter((ep) => ep.steps.some((s) => s.kind === "reducer" && s.name === reducer));
    expect(eps).toHaveLength(1);
    const steps = eps[0]?.steps ?? [];
    const step = steps.find((s) => s.kind === "reducer");
    return {
      emits: step?.kind === "reducer" ? step.emits : [],
      cancels: steps.filter((s) => s.kind === "effect-cancel"),
      ends: steps.filter((s) => s.kind === "effect-end"),
    };
  }

  const allCancels = (logger: EpisodeLogger): EpisodeStep[] =>
    logger
      .list()
      .flatMap((ep) => ep.steps)
      .filter((s) => s.kind === "effect-cancel");

  const cancelOf = (targetId: string) => ({
    kind: "effect-cancel",
    targetId,
    ts: expect.any(Number),
  });

  it.each([
    "req",
    "thr",
  ])("a cancel that aborts a %s request in flight records the id it aborted, and the .err lands on the episode that started it", async (effect) => {
    await withApp(async ({ start, kill, held, logger }) => {
      start(effect, `${effect}#1`);
      await tick(5);
      kill(`${effect}#1`);
      await tick(5);
      expect(held[effect]?.[0]?.signal?.aborted).toBe(true);
      expect(episodeOf(logger, "kill")).toEqual({
        emits: ["cancel"],
        cancels: [cancelOf(`${effect}#1`)],
        ends: [],
      });
      expect(episodeOf(logger, "start").ends).toEqual([
        { kind: "effect-end", name: effect, result: "err", value: ABORTED, ts: expect.any(Number) },
      ]);
    });
  });

  it("a cancel of an id no request runs under records no effect-cancel, and the one in flight runs on", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("req", "req#1");
      await tick(5);
      kill("req#2");
      await tick(5);
      expect(held.req?.[0]?.signal?.aborted).toBe(false);
      expect(episodeOf(logger, "kill")).toEqual({ emits: ["cancel"], cancels: [], ends: [] });
      expect(allCancels(logger)).toEqual([]);
    });
  });

  it("a cancel while a request waits between retry attempts records its id", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("retried", "retried#1");
      await tick(5);
      expect(held.retried).toHaveLength(1);
      kill("retried#1");
      // Long enough for a next attempt, had the abort not ended the wait.
      await tick(80);
      expect(held.retried).toHaveLength(1);
      expect(held.retried?.[0]?.signal?.aborted).toBe(true);
      expect(episodeOf(logger, "kill").cancels).toEqual([cancelOf("retried#1")]);
    });
  });

  it("a cancel of a request that already completed records no effect-cancel", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("req", "req#1");
      await tick(5);
      held.req?.[0]?.resolve({ kind: "ok", value: "done" });
      await tick(5);
      kill("req#1");
      await tick(5);
      expect(episodeOf(logger, "kill")).toEqual({ emits: ["cancel"], cancels: [], ends: [] });
      expect(allCancels(logger)).toEqual([]);
    });
  });

  it.each([
    ["ok", { kind: "ok", value: "own#1" }],
    ["err", { kind: "err", value: "own#1" }],
  ] as [
    string,
    EffectResult,
  ][])("a cancel the request's own .%s reducer emits for its id records no effect-cancel, and aborts nothing", async (_outcome, result) => {
    await withApp(async ({ start, held, logger }) => {
      start("own", "own#1");
      await tick(5);
      held.own?.[0]?.resolve(result);
      await tick(5);
      expect(held.own?.[0]?.signal?.aborted).toBe(false);
      expect(allCancels(logger)).toEqual([]);
    });
  });

  it("a cancel of EffectId.none records no effect-cancel", async () => {
    await withApp(async ({ start, kill, logger }) => {
      start("req", "req#1");
      await tick(5);
      kill("");
      await tick(5);
      expect(episodeOf(logger, "kill")).toEqual({ emits: ["cancel"], cancels: [], ends: [] });
    });
  });

  it("a cancel that removes a queue entry still waiting records its id, and the running entry runs on", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("queued", "queued#1");
      start("queued", "queued#2");
      await tick(5);
      expect(held.queued).toHaveLength(1);
      kill("queued#2");
      await tick(5);
      expect(held.queued?.[0]?.signal?.aborted).toBe(false);
      expect(episodeOf(logger, "kill").cancels).toEqual([cancelOf("queued#2")]);
      // The episode that emitted the released entry records its own release, by effect name, and
      // settles.
      const owner = logger
        .list()
        .find((ep) => ep.steps.some((s) => s.kind === "effect-start" && s.name === "queued"));
      expect(owner?.steps.filter((s) => s.kind === "effect-cancel")).toEqual([cancelOf("queued")]);
    });
  });

  it("a cancel that clears a pending debounce timer records its id", async () => {
    await withApp(async ({ start, kill, logger }) => {
      start("deb", "deb#1");
      kill("deb#1");
      await tick(5);
      expect(episodeOf(logger, "kill").cancels).toEqual([cancelOf("deb#1")]);
    });
  });

  it.each([
    "deb",
    "queued",
  ])("a %s launch and its cancel from one reducer record both steps on that reducer's episode", async (effect) => {
    await withApp(async ({ startAndKill, held, logger }) => {
      startAndKill(effect, `${effect}#1`);
      await tick(5);
      expect(held[effect]).toHaveLength(0);
      const eps = logger.list();
      expect(eps).toHaveLength(1);
      expect(eps[0]?.steps.filter((s) => s.kind.startsWith("effect-"))).toEqual([
        { kind: "effect-start", name: effect, args: {}, ts: expect.any(Number) },
        cancelOf(effect),
        cancelOf(`${effect}#1`),
      ]);
    });
  });

  it("a request one reducer launches is already in flight for the cancel that reducer emits", async () => {
    await withApp(async ({ startAndKill, held, logger }) => {
      startAndKill("req", "req#1");
      await tick(5);
      expect(held.req?.[0]?.signal?.aborted).toBe(true);
      const eps = logger.list();
      expect(eps).toHaveLength(1);
      expect(eps[0]?.steps.filter((s) => s.kind.startsWith("effect-"))).toEqual([
        { kind: "effect-start", name: "req", args: {}, ts: expect.any(Number) },
        cancelOf("req#1"),
        { kind: "effect-end", name: "req", result: "err", value: ABORTED, ts: expect.any(Number) },
      ]);
    });
  });

  it("a cancel of a debounce emit a later one replaced clears the later one's timer, and records the id it named", async () => {
    await withApp(async ({ start, kill, logger }) => {
      start("deb", "deb#1");
      start("deb", "deb#2");
      // `deb#1` names what replaced it, so this clears `deb#2`'s timer.
      kill("deb#1");
      await tick(5);
      expect(episodeOf(logger, "kill").cancels).toEqual([cancelOf("deb#1")]);
      // The replace released `deb#1`'s claim and the clear released `deb#2`'s, each on its own
      // episode.
      expect(allCancels(logger)).toEqual([cancelOf("deb"), cancelOf("deb"), cancelOf("deb#1")]);
      // Nothing is left pending, so cancelling `deb#2` releases nothing.
      kill("deb#2");
      await tick(5);
      const killEps = logger
        .list()
        .filter((ep) => ep.steps.some((s) => s.kind === "reducer" && s.name === "kill"));
      expect(killEps.map((ep) => ep.steps.filter((s) => s.kind === "effect-cancel"))).toEqual([
        [cancelOf("deb#1")],
        [],
      ]);
    });
  });

  it.each([
    "thr",
    "once",
  ])("a cancel of an emit %s dropped aborts the request that absorbed it, and records the id it named", async (effect) => {
    await withApp(async ({ start, kill, held, logger }) => {
      start(effect, `${effect}#1`);
      start(effect, `${effect}#2`);
      await tick(5);
      expect(held[effect]).toHaveLength(1);
      kill(`${effect}#2`);
      await tick(5);
      expect(held[effect]?.[0]?.signal?.aborted).toBe(true);
      expect(episodeOf(logger, "kill").cancels).toEqual([cancelOf(`${effect}#2`)]);
    });
  });

  it.each([
    "thr",
    "once",
  ])("a cancel of an emit %s dropped, after the request that absorbed it completed, records no effect-cancel", async (effect) => {
    await withApp(async ({ start, kill, held, logger }) => {
      start(effect, `${effect}#1`);
      start(effect, `${effect}#2`);
      await tick(5);
      held[effect]?.[0]?.resolve({ kind: "ok", value: "done" });
      await tick(5);
      kill(`${effect}#2`);
      await tick(5);
      expect(episodeOf(logger, "kill")).toEqual({ emits: ["cancel"], cancels: [], ends: [] });
      expect(allCancels(logger)).toEqual([]);
    });
  });

  it("a cancel that finds only a throttle window open records no effect-cancel, and the window stays", async () => {
    await withApp(async ({ start, kill, held, logger }) => {
      start("thr", "thr#1");
      await tick(5);
      held.thr?.[0]?.resolve({ kind: "ok", value: "done" });
      await tick(5);
      kill("thr#1");
      await tick(5);
      expect(episodeOf(logger, "kill")).toEqual({ emits: ["cancel"], cancels: [], ends: [] });
      // The window is the effect's, not a pending launch: it still holds.
      start("thr", "thr#2");
      await tick(5);
      expect(held.thr).toHaveLength(1);
    });
  });
});

describe("a latest-per-key emit that carries its key", () => {
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
                resolve({ kind: "err", value: httpError(0, "aborted") });
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
    const root = freshRoot();
    try {
      const { dispose } = mount(app, root);
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("go", {});
      await tick(5);
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

describe("the EffectId an emit yields", () => {
  type Policy = EffectSpec["policy"];
  const idOf = (policy: Policy, emit: EmitSpec): string => emitId(policy ? { policy } : {}, emit);

  it.each([
    ["no policy", undefined],
    ["queue", { kind: "queue" }],
    ["once", { kind: "once" }],
    ["debounce", { kind: "debounce", ms: 5 }],
    ["throttle", { kind: "throttle", ms: 5 }],
  ] as [
    string,
    Policy,
  ][])("%s: a new id per emit, or the id the record already carries", (_l, policy) => {
    const a = idOf(policy, { effect: "up", args: ["x"] });
    expect(idOf(policy, { effect: "up", args: ["x"] })).not.toBe(a);
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
  });

  it("latest-per-key: the key an emit carries wins over keyOf", () => {
    const policy: Policy = { kind: "latest-per-key", keyOf: (input) => String(input) };
    const x = idOf(policy, { effect: "up", args: ["x"] });
    expect(idOf(policy, { effect: "up", args: ["y"], key: "x" })).toBe(x);
  });

  it("reads its new part as an effect-id, a kind of its own", () => {
    const out = withEnvRecord(() => idOf({ kind: "queue" }, { effect: "up", args: ["x"] }));
    expect(out.env.reads.map((r) => r.kind)).toEqual(["effect-id"]);
  });

  it("takes no answer recorded for <T>.fresh(), so an extra emit cannot shift a fresh id", () => {
    // A log recorded before emits read anything holds the one `fresh()` answer.
    const out = withEnvReplay([{ kind: "fresh-id", value: "U1" }], () => ({
      id: idOf({ kind: "queue" }, { effect: "work", args: ["x"] }),
      row: _stdlibCore.freshId(),
    }));
    expect(out.ok && out.value.row).toBe("U1");
    expect(out.ok && out.value.id).not.toBe("work#U1");
    expect(out.env).toMatchObject({ live: 1, unused: 0 });
  });
});

describe("dispose", () => {
  it("aborts every request in flight, two of one effect included", async () => {
    const signals: AbortSignal[] = [];
    const app: AppShape = {
      slots: {},
      caps: ["http.get"],
      effects: {
        work: {
          name: "work",
          cap: "http.get",
          invoke: (_input, _caps, signal) =>
            new Promise<EffectResult>((resolve) => {
              if (signal) signals.push(signal);
              signal?.addEventListener("abort", () =>
                resolve({ kind: "err", value: httpError(0, "aborted") }),
              );
            }),
        },
      },
      init: [],
      reducers: [
        {
          name: "go",
          event: { kind: "ui", ev: "click" },
          apply: () => ({
            slots: {},
            emits: [
              { effect: "work", args: ["a"] },
              { effect: "work", args: ["b"] },
            ],
          }),
        },
      ],
    };
    const root = freshRoot();
    try {
      const { dispose } = mount(app, root);
      (app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void })._dispatch(
        "go",
        {},
      );
      await tick(5);
      expect(signals).toHaveLength(2);
      dispose();
      expect(signals.map((sg) => sg.aborted)).toEqual([true, true]);
    } finally {
      root.remove();
    }
  });
});
