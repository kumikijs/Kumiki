import type { AppShape, CapabilityProvider, EffectResult, MountedApp } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { tick } from "./helpers/time.ts";

const CAP = "telemetry.track";

function makeTrackApp(): AppShape {
  return bareApp({
    slots: { sent: { value: 0 }, failed: { value: false }, problem: { value: null } },
    caps: [CAP],
    effects: {
      track: {
        name: "track",
        cap: CAP,
        invoke: async (input, caps) => {
          const p = caps.provider(CAP);
          if (!p) {
            return { kind: "err", value: { message: `Capability "${CAP}" has no provider` } };
          }
          return p(input, caps);
        },
      },
    },
    reducers: [
      {
        name: "fire",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [{ effect: "track", args: [{ name: "click" }] }] }),
      },
      {
        name: "onSent",
        event: { kind: "effect", effect: "track", outcome: "ok" },
        apply: (live) => ({ slots: { sent: (live.sent as number) + 1 }, emits: [] }),
      },
      {
        name: "onFail",
        event: { kind: "effect", effect: "track", outcome: "err" },
        apply: (_live, payload) => ({ slots: { failed: true, problem: payload.$1 }, emits: [] }),
      },
    ],
    root: () => ({ kind: "column", children: [] }),
  });
}

function makeBuiltinApp(): AppShape {
  return bareApp({
    slots: { ok: { value: false } },
    caps: ["notification.show", "nav.push"],
    reducers: [
      {
        name: "doToast",
        event: { kind: "ui", ev: "click" },
        apply: () => ({
          slots: {},
          emits: [{ effect: "toast", args: [{ kind: "info", text: "hi-toast" }] }],
        }),
      },
      {
        name: "doNav",
        event: { kind: "ui", ev: "click" },
        apply: () => ({
          slots: {},
          emits: [{ effect: "navigate", args: [{ path: "/elsewhere" }] }],
        }),
      },
    ],
    root: () => ({ kind: "column", children: [] }),
  });
}

const dispatch = (app: AppShape, name: string): void => (app as MountedApp)._dispatch(name, {});

const recording =
  (seen: unknown[]): CapabilityProvider =>
  async (input) => {
    seen.push(input);
    return { kind: "ok", value: null };
  };

let root: HTMLElement;
beforeEach(() => {
  root = freshRoot();
});
afterEach(() => {
  root.remove();
  vi.restoreAllMocks();
});

describe("capability providers", () => {
  it("calls a registered provider and flows its ok result into the reducer", async () => {
    const app = makeTrackApp();
    const seen: unknown[] = [];
    mount(app, root, { providers: { [CAP]: recording(seen) } });
    dispatch(app, "fire");
    await tick(0);
    expect(seen).toEqual([{ name: "click" }]);
    expect(app.live).toMatchObject({ sent: 1, failed: false });
  });

  it.each<[string, CapabilityProvider | undefined, { sent: number; failed: boolean }]>([
    ["errs when the custom capability has no provider", undefined, { sent: 0, failed: true }],
    [
      "accepts a provider that returns its result synchronously",
      () => ({ kind: "ok", value: null }),
      { sent: 1, failed: false },
    ],
    [
      "turns a throwing provider into an err outcome",
      () => {
        throw new Error("boom");
      },
      { sent: 0, failed: true },
    ],
    [
      "accepts an ok result with no value, as a host may return for a Unit result",
      () => ({ kind: "ok" }) as EffectResult,
      { sent: 1, failed: false },
    ],
  ])("%s", async (_, provider, outcome) => {
    const app = makeTrackApp();
    mount(app, root, provider ? { providers: { [CAP]: provider } } : {});
    dispatch(app, "fire");
    await tick(0);
    expect(app.live).toMatchObject(outcome);
  });

  it("does not invoke the provider when the capability is not declared", async () => {
    const app = makeTrackApp();
    app.caps = [];
    const seen: unknown[] = [];
    mount(app, root, { providers: { [CAP]: recording(seen) } });
    dispatch(app, "fire");
    await tick(0);
    expect(seen).toEqual([]);
    expect(app.live?.sent).toBe(0);
  });
});

describe("a provider result that is not {kind, value}", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const bare: { self?: unknown } = Object.create(null);
  bare.self = bare;
  const notAResult: [string, unknown, string][] = [
    ["a record with no kind", { ok: true }, '{"ok":true}'],
    ["a bare Text", "done", '"done"'],
    ["a kind other than ok and err", { kind: "success", value: 1 }, '{"kind":"success","value":1}'],
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["a Symbol, which JSON has no text for", Symbol("x"), "Symbol(x)"],
    ["a returned Error", new Error("boom"), "Error: boom"],
    ["a BigInt, which JSON cannot write", 10n, "10"],
    ["a cycle, which JSON cannot write", cyclic, "[object Object]"],
    ["a cycle String() cannot print either", bare, "[object Object]"],
    ["a text of 200 characters", "x".repeat(198), `"${"x".repeat(198)}"`],
    ["a text past 200 characters", "x".repeat(199), `"${"x".repeat(199)}…`],
    [
      "a text past 200 characters, cut between characters",
      "😀".repeat(250),
      `"${"😀".repeat(199)}…`,
    ],
  ];
  const named = (shown: string): string =>
    `Error: effect "track" (${CAP}) resolved to ${shown}, not {kind, value}`;

  it.each(
    notAResult,
  )("is the request's err when it is %s, naming it", async (_, returned, shown) => {
    const app = makeTrackApp();
    const handle = mount(app, root, {
      providers: { [CAP]: () => returned as EffectResult },
    });
    dispatch(app, "fire");
    await tick(0);
    expect(app.live).toMatchObject({ sent: 0, failed: true, problem: { message: named(shown) } });
    handle.dispose();
  });

  it("is reported as an err no .err reducer takes", async () => {
    const errors = captureConsole();
    const app = makeTrackApp();
    app.reducers = app.reducers.filter((r) => r.name !== "onFail");
    const handle = mount(app, root, {
      providers: { [CAP]: () => ({ ok: true }) as unknown as EffectResult },
    });
    dispatch(app, "fire");
    await tick(0);
    expect(errors).toEqual([
      `[kumiki] effect "track" returned an error with no .err reducer: ${named('{"ok":true}')}`,
    ]);
    handle.dispose();
  });
});

describe("standard capability override", () => {
  it("routes a built-in toast to a host provider instead of the default banner", async () => {
    const app = makeBuiltinApp();
    const seen: unknown[] = [];
    mount(app, root, { providers: { "notification.show": recording(seen) } });
    dispatch(app, "doToast");
    await tick(0);
    expect(seen).toEqual([{ kind: "info", text: "hi-toast" }]);
    expect(document.body.textContent ?? "").not.toContain("hi-toast");
  });

  it("falls back to the built-in toast when no provider is registered", async () => {
    const app = makeBuiltinApp();
    mount(app, root);
    dispatch(app, "doToast");
    await tick(0);
    const banner = Array.from(document.body.querySelectorAll("div")).find((d) =>
      (d.textContent ?? "").includes("hi-toast"),
    );
    expect(banner).toBeTruthy();
    banner?.remove();
  });

  it("routes built-in navigation to a host provider instead of the history API", async () => {
    const app = makeBuiltinApp();
    const seen: unknown[] = [];
    const before = location.pathname;
    mount(app, root, { providers: { "nav.push": recording(seen) } });
    dispatch(app, "doNav");
    await tick(0);
    expect(seen).toEqual([{ path: "/elsewhere" }]);
    expect(location.pathname).toBe(before);
  });
});
