// Coverage for EffectSpec.retry (#83): the dispatcher retries 5xx / connection
// errors with the configured backoff, leaves 4xx alone, and propagates the
// final result to the .err / .ok reducer like a normal invoke.

import type { AppShape, EffectResult } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
        retry: args.retry,
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

describe("EffectSpec.retry (#83)", () => {
  it("retries 5xx until success (linear)", async () => {
    const state = makeApp({
      retry: { kind: "linear", n: 3, ms: 1 },
      responses: [
        { kind: "err", value: { status: 503, message: "x" } },
        { kind: "err", value: { status: 503, message: "x" } },
        { kind: "ok", value: { hello: "world" } },
      ],
    });
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(state.app, root);
      await tick(60);
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
    const root = document.createElement("div");
    document.body.appendChild(root);
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
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(state.app, root);
      await tick(40);
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
    const root = document.createElement("div");
    document.body.appendChild(root);
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
