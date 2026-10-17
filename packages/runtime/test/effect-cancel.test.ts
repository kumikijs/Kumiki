import type { AppShape, EffectResult, EffectSpec, EmitSpec } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { emitId } from "../src/core.ts";
import { freshRoot } from "./helpers/dom.ts";
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
      expect(lastErr?.value).toMatchObject({ status: 0, message: "aborted", body: "" });
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

  it("records an effect-cancel step in the episode logger", async () => {
    const { app } = makeCancelApp();
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const root = freshRoot();
    try {
      const { dispose } = mount(app, root, { episodeLogger: logger });
      const dispatch = (
        app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void }
      )._dispatch;
      dispatch("go", {});
      await tick(5);
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
  ] as [string, Policy][])("%s: one id per emit, and the one an emit carries", (_l, policy) => {
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
    // The key the emit carries wins over the one `keyOf` reads.
    expect(idOf(policy, { effect: "up", args: ["y"], key: "x" })).toBe(x);
  });
});
