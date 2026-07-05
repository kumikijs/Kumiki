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
import { renderToString, routing } from "@kumikijs/runtime";
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

  it("resets app.live to slot defaults after each request so the next request can't see leftovers", async () => {
    // Edge / Node SSR runs the same module-singleton `App` across many
    // requests. A leaked `app.live` would mean user A's `user` slot lands
    // in user B's HTML and snapshot.
    const { app } = makeSsrApp();

    const providerA = vi.fn<CapabilityProvider>(async () => ({
      kind: "ok",
      value: { id: "u_A", name: "Alice" },
    }));
    const resultA = await renderToString(app, { providers: { "http.get": providerA } });
    expect(resultA.snapshot.slots.user).toEqual({ id: "u_A", name: "Alice" });

    // The shared singleton was wiped back to slot defaults on the way out
    // of `renderToString`, so anyone reading `app.live` between requests
    // sees `guest`, never Alice.
    expect(app.live?.user).toEqual({ id: "guest", name: "guest" });
    expect(app.live?.count).toBe(0);

    // Request B with a different provider — must see DEFAULTS in dispatchEmit,
    // never carry-over from request A.
    const providerB = vi.fn<CapabilityProvider>(async () => ({
      kind: "ok",
      value: { id: "u_B", name: "Bob" },
    }));
    const resultB = await renderToString(app, { providers: { "http.get": providerB } });
    expect(resultB.snapshot.slots.user).toEqual({ id: "u_B", name: "Bob" });
    expect(resultB.snapshot.slots.count).toBe(0);
  });

  it("records a panic step when an SSR reducer throws — never silent", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = makeSsrApp();
    // Replace the userLoaded reducer with one that throws so SSR observes
    // a reducer panic on a happy-path effect outcome.
    app.reducers = app.reducers.map((r) =>
      r.name === "userLoaded"
        ? {
            ...r,
            apply: () => {
              throw new Error("boom from userLoaded");
            },
          }
        : r,
    );
    const result = await renderToString(app, {
      providers: {
        "http.get": async () => ({ kind: "ok", value: { id: "u_1", name: "Yui" } }),
      },
    });

    const panicStep = result.bootstrapEpisode.steps.find((s) => s.kind === "panic");
    expect(panicStep).toBeDefined();
    expect((panicStep as { message: string }).message).toContain("boom");
    expect(result.bootstrapEpisode.status).toBe("panic");
    consoleErr.mockRestore();
  });

  it("reports an unhandled effect err via console.error (no-silent-failure #37)", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = makeSsrApp();
    // Drop the userFailed reducer so the err outcome has no consumer.
    app.reducers = app.reducers.filter((r) => r.name !== "userFailed");
    await renderToString(app, {
      providers: { "http.get": async () => ({ kind: "err", value: "network" }) },
    });

    expect(consoleErr).toHaveBeenCalled();
    const firstCall = String(consoleErr.mock.calls[0]?.[0] ?? "");
    expect(firstCall).toContain("loadUser");
    consoleErr.mockRestore();
  });

  it("routes a 401 err through app.http.on401 — even with no per-effect .err reducer", async () => {
    const { app } = makeSsrApp();
    // Drop the per-effect err handler so only the HTTP status routing path
    // can catch the failure.
    app.reducers = app.reducers.filter((r) => r.name !== "userFailed");
    app.reducers.push({
      name: "loginRequired",
      event: { kind: "lifecycle", name: "loginRequired" },
      apply: () => ({ slots: { user: { id: "redirect", name: "/login" } }, emits: [] }),
    });
    app.http = { on401: "loginRequired" };

    const result = await renderToString(app, {
      providers: {
        "http.get": async () => ({
          kind: "err",
          value: { status: 401, message: "unauthorized" },
        }),
      },
    });

    expect(result.snapshot.slots.user).toEqual({ id: "redirect", name: "/login" });
    const reducerStep = result.bootstrapEpisode.steps.find(
      (s) => s.kind === "reducer" && (s as { name: string }).name === "loginRequired",
    );
    expect(reducerStep).toBeDefined();
  });

  it("matches dynamic route patterns via routing.parseLocation", async () => {
    const { app, httpProvider } = makeSsrApp();
    const postTile = (): TileNode => ({
      kind: "heading",
      text: `post ${(app.live?.route as { params: { id: string } }).params.id}`,
    });
    const fallbackTile = (): TileNode => ({ kind: "heading", text: "not found" });
    app.routes = [
      { pattern: "/posts/:id", tile: postTile },
      { pattern: "/404", tile: fallbackTile },
    ];

    const result = await renderToString(app, {
      route: "/posts/abc",
      routing,
      providers: { "http.get": httpProvider },
    });

    // Concrete path stays in snapshot.route + bootstrap.trigger.target;
    // the pattern with params is what the live tile renders against.
    expect(result.snapshot.route).toBe("/posts/abc");
    expect(result.bootstrapEpisode.trigger.target).toBe("/posts/abc");
    expect(result.html).toContain("post abc");
    expect(result.html).not.toContain("not found");
  });

  it("falls back to literal route matching when no routing is provided", async () => {
    const { app, httpProvider } = makeSsrApp();
    app.routes = [
      { pattern: "/static", tile: (): TileNode => ({ kind: "heading", text: "static page" }) },
      { pattern: "/404", tile: (): TileNode => ({ kind: "heading", text: "not found" }) },
    ];

    // No `routing` opt — `/static` matches verbatim, dynamic patterns don't.
    const result = await renderToString(app, {
      route: "/static",
      providers: { "http.get": httpProvider },
    });
    expect(result.html).toContain("static page");
  });

  it("dispatches app.init emits concurrently (Promise.all parity with live)", async () => {
    const { app } = makeSsrApp();
    // Add a second init effect so we can observe concurrency.
    const order: string[] = [];
    app.effects.slowOne = {
      name: "slowOne",
      cap: "http.get",
      invoke: async () => {
        order.push("slowOne:start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("slowOne:end");
        return { kind: "ok", value: null };
      },
    };
    app.effects.fastTwo = {
      name: "fastTwo",
      cap: "http.get",
      invoke: async () => {
        order.push("fastTwo:start");
        await new Promise((r) => setTimeout(r, 5));
        order.push("fastTwo:end");
        return { kind: "ok", value: null };
      },
    };
    app.init = [
      { effect: "slowOne", args: [] },
      { effect: "fastTwo", args: [] },
    ];
    // Drop the loadUser reducer set so we don't need a real provider.
    app.reducers = [];

    await renderToString(app);

    // Sequential await would force `slowOne:end` before `fastTwo:start`.
    // Concurrent dispatch lets the fast emit start before the slow one ends.
    const slowEnd = order.indexOf("slowOne:end");
    const fastStart = order.indexOf("fastTwo:start");
    expect(fastStart).toBeLessThan(slowEnd);
  });
});
