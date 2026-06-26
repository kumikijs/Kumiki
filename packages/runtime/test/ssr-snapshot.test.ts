// SSR snapshot construction (docs/spec/runtime.md §10.6.1) — unit tests over
// `renderToString`. Builds an AppShape by hand so the test isn't entangled
// with the compiler, then asserts the snapshot envelope shape, the volatile
// filter, and the bootstrap episode causal chain.

import type {
  AppShape,
  CapabilityProvider,
  EffectSpec,
  RenderedSnapshot,
  TileNode,
} from "@kumikijs/runtime";
import { renderToString } from "@kumikijs/runtime";
import { describe, expect, it, vi } from "vitest";

type User = { id: string; name: string };

function makeSsrApp(): { app: AppShape; httpProvider: ReturnType<typeof vi.fn> } {
  const httpProvider = vi.fn<CapabilityProvider>(async () => ({
    kind: "ok",
    value: { id: "u_1", name: "Yui" },
  }));

  const loadUserEffect: EffectSpec = {
    name: "loadUser",
    cap: "http.get",
    invoke: async (input, caps) => {
      const provider = caps.provider("http.get");
      if (!provider) return { kind: "err", value: "no provider" };
      return await provider(input, caps);
    },
  };

  const app: AppShape = {
    slots: {
      user: { value: { id: "guest", name: "guest" } satisfies User },
      count: { value: 0 },
      // language.md §175: `draft` is volatile — neither the snapshot.slots
      // map nor the bootstrap episode's slot-diffs may carry it.
      draft: { value: "", volatile: true },
    },
    caps: ["http.get"],
    effects: { loadUser: loadUserEffect },
    init: [{ effect: "loadUser", args: [{ url: "/api/me" }] }],
    reducers: [
      {
        name: "userLoaded",
        event: { kind: "effect", effect: "loadUser", outcome: "ok" },
        apply: (_live, payload) => ({
          slots: { user: payload.$1 as User },
          emits: [],
        }),
      },
      {
        name: "userFailed",
        event: { kind: "effect", effect: "loadUser", outcome: "err" },
        apply: () => ({
          slots: { user: { id: "guest", name: "guest" } },
          emits: [],
        }),
      },
      {
        name: "inc",
        selector: { tile: "IncBtn" },
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
      },
    ],
    root: (): TileNode => ({
      kind: "column",
      children: [
        {
          kind: "heading",
          text: `Hi ${((app.live?.user as User) ?? { name: "?" }).name}`,
        },
        { kind: "text", text: `count: ${app.live?.count ?? 0}` },
        { kind: "button", text: "+" },
      ],
    }),
  };

  return { app, httpProvider };
}

describe("renderToString §10.6.1", () => {
  it("returns html, snapshot envelope, and bootstrap episode", async () => {
    const { app, httpProvider } = makeSsrApp();
    let nowCounter = 1_700_000_000_000;
    const result = await renderToString(app, {
      providers: { "http.get": httpProvider },
      now: () => nowCounter++,
    });

    expect(result.html).toContain("Hi Yui");
    expect(result.html).toContain("count: 0");
    expect(result.snapshot.kumiki).toBe(1);
    expect(result.snapshot.route).toBe("/");
    expect(typeof result.snapshot.renderedAt).toBe("number");
    expect(result.snapshot.bootstrap).toBe(result.bootstrapEpisode);
  });

  it("excludes volatile slots from snapshot.slots", async () => {
    const { app, httpProvider } = makeSsrApp();
    const result = await renderToString(app, {
      providers: { "http.get": httpProvider },
    });

    expect(Object.keys(result.snapshot.slots).sort()).toEqual(["count", "user"]);
    expect(result.snapshot.slots).not.toHaveProperty("draft");
    expect(result.snapshot.slots.user).toEqual({ id: "u_1", name: "Yui" });
    expect(result.snapshot.slots.count).toBe(0);
  });

  it("bootstrap.trigger.kind is 'ssr.hydrate' with the requested route as target", async () => {
    const { app, httpProvider } = makeSsrApp();
    const result = await renderToString(app, {
      route: "/posts/abc",
      providers: { "http.get": httpProvider },
    });
    expect(result.bootstrapEpisode.trigger.kind).toBe("ssr.hydrate");
    expect(result.bootstrapEpisode.trigger.target).toBe("/posts/abc");
    expect(result.bootstrapEpisode.status).toBe("completed");
  });

  it("bootstrap.steps mirror the real effect-start / effect-end / reducer chain", async () => {
    const { app, httpProvider } = makeSsrApp();
    const result = await renderToString(app, {
      providers: { "http.get": httpProvider },
    });

    const kinds = result.bootstrapEpisode.steps.map((s) => s.kind);
    expect(kinds).toEqual(["effect-start", "effect-end", "reducer", "signal-update"]);

    const reducerStep = result.bootstrapEpisode.steps.find((s) => s.kind === "reducer");
    expect(reducerStep).toMatchObject({
      kind: "reducer",
      name: "userLoaded",
      emits: [],
    });
    expect(reducerStep).toHaveProperty("slot-diffs");
    const diffs = (reducerStep as { "slot-diffs": Array<{ name: string }> })["slot-diffs"];
    expect(diffs.map((d) => d.name)).toEqual(["user"]);
    // Volatile slot must never leak into slot-diffs (§10.6.1 spec rule).
    expect(diffs.find((d) => d.name === "draft")).toBeUndefined();
  });

  it("dispatches custom providers exactly once even when reducers don't emit further effects", async () => {
    const { app, httpProvider } = makeSsrApp();
    await renderToString(app, { providers: { "http.get": httpProvider } });
    expect(httpProvider).toHaveBeenCalledTimes(1);
  });

  it("propagates a provider err result through the loadUser.err reducer", async () => {
    const { app } = makeSsrApp();
    const provider = vi.fn<CapabilityProvider>(async () => ({
      kind: "err",
      value: "network",
    }));
    const result = await renderToString(app, {
      providers: { "http.get": provider },
    });

    expect(result.snapshot.slots.user).toEqual({ id: "guest", name: "guest" });
    const kinds = result.bootstrapEpisode.steps.map((s) => s.kind);
    expect(kinds).toEqual(["effect-start", "effect-end", "reducer", "signal-update"]);
    const reducerStep = result.bootstrapEpisode.steps.find((s) => s.kind === "reducer");
    expect(reducerStep).toMatchObject({ kind: "reducer", name: "userFailed" });
  });

  it("snapshot has the same shape we declare in the RenderedSnapshot type", async () => {
    const { app, httpProvider } = makeSsrApp();
    const result = await renderToString(app, {
      providers: { "http.get": httpProvider },
    });
    const snap: RenderedSnapshot = result.snapshot;
    expect(snap).toMatchObject({
      kumiki: 1,
      route: "/",
      slots: expect.any(Object),
      bootstrap: expect.objectContaining({ trigger: expect.any(Object) }),
      renderedAt: expect.any(Number),
    });
  });
});
