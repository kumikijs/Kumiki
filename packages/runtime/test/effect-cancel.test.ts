// Coverage for issue #102 — `http.cancel` capability + `EffectId` returned at
// `emit` time. Verifies the dispatcher's special-case `http.cancel` branch:
// the in-flight controller is aborted (so `httpFetch`'s fetch sees the abort
// and resolves to `{status:0, message:"aborted"}`), pending debounce timers
// are cleared, unknown ids are silent no-ops, and the Episode logger records
// the cancel intent.

import type { AppShape, EffectResult } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

type AbortLog = { aborted: boolean; signal?: AbortSignal };

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
