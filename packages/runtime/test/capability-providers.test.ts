import type { AppShape, CapabilityProvider, MountedApp } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";
import { tick } from "./helpers/time.ts";

const CAP = "telemetry.track";

function makeTrackApp(): AppShape {
  return bareApp({
    slots: { sent: { value: 0 }, failed: { value: false } },
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
        apply: () => ({ slots: { failed: true }, emits: [] }),
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
