import type { AppShape, TileNode } from "@kumikijs/runtime";
import { renderToString, routing } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "./helpers/console.ts";
import { GUEST, userApp, userProvider } from "./helpers/ssr-user-app.ts";
import { tick } from "./helpers/time.ts";

function makeSsrApp(): AppShape {
  return userApp([
    {
      name: "userFailed",
      event: { kind: "effect", effect: "loadUser", outcome: "err" },
      apply: () => ({ slots: { user: GUEST }, emits: [] }),
    },
  ]);
}

/** `makeSsrApp` whose `userLoaded` reducer throws `error`. */
function panickingApp(error: Error): AppShape {
  const app = makeSsrApp();
  app.reducers = app.reducers.map((r) =>
    r.name === "userLoaded"
      ? {
          ...r,
          apply: () => {
            throw error;
          },
        }
      : r,
  );
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderToString", () => {
  it("returns html, snapshot envelope, and bootstrap episode", async () => {
    let nowCounter = 1_700_000_000_000;
    const result = await renderToString(makeSsrApp(), {
      providers: { "http.get": userProvider() },
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
    const result = await renderToString(makeSsrApp(), {
      providers: { "http.get": userProvider() },
    });

    expect(Object.keys(result.snapshot.slots).sort()).toEqual(["count", "user"]);
    expect(result.snapshot.slots.user).toEqual({ id: "u_1", name: "Yui" });
    expect(result.snapshot.slots.count).toBe(0);
  });

  it("bootstrap.trigger.kind is 'ssr.hydrate' with the requested route as target", async () => {
    const result = await renderToString(makeSsrApp(), {
      route: "/posts/abc",
      providers: { "http.get": userProvider() },
    });
    expect(result.bootstrapEpisode.trigger.kind).toBe("ssr.hydrate");
    expect(result.bootstrapEpisode.trigger.target).toBe("/posts/abc");
    expect(result.bootstrapEpisode.status).toBe("completed");
  });

  it("bootstrap.steps mirror the real effect-start / effect-end / reducer chain", async () => {
    const result = await renderToString(makeSsrApp(), {
      providers: { "http.get": userProvider() },
    });

    const kinds = result.bootstrapEpisode.steps.map((s) => s.kind);
    expect(kinds).toEqual(["effect-start", "effect-end", "reducer", "signal-update"]);

    const reducerStep = result.bootstrapEpisode.steps.find((s) => s.kind === "reducer");
    expect(reducerStep).toMatchObject({ kind: "reducer", name: "userLoaded", emits: [] });
    const diffs = (reducerStep as { "slot-diffs": Array<{ name: string }> })["slot-diffs"];
    expect(diffs.map((d) => d.name)).toEqual(["user"]);
  });

  it("dispatches custom providers exactly once even when reducers don't emit further effects", async () => {
    const httpProvider = userProvider();
    await renderToString(makeSsrApp(), { providers: { "http.get": httpProvider } });
    expect(httpProvider).toHaveBeenCalledTimes(1);
  });

  it("propagates a provider err result through the loadUser.err reducer", async () => {
    const result = await renderToString(makeSsrApp(), {
      providers: { "http.get": async () => ({ kind: "err", value: "network" }) },
    });

    expect(result.snapshot.slots.user).toEqual(GUEST);
    const kinds = result.bootstrapEpisode.steps.map((s) => s.kind);
    expect(kinds).toEqual(["effect-start", "effect-end", "reducer", "signal-update"]);
    const reducerStep = result.bootstrapEpisode.steps.find((s) => s.kind === "reducer");
    expect(reducerStep).toMatchObject({ kind: "reducer", name: "userFailed" });
  });

  it("resets app.live to slot defaults after each request so the next request can't see leftovers", async () => {
    const app = makeSsrApp();

    const providerA = userProvider({ id: "u_A", name: "Alice" });
    const resultA = await renderToString(app, { providers: { "http.get": providerA } });
    expect(resultA.snapshot.slots.user).toEqual({ id: "u_A", name: "Alice" });

    expect(app.live?.user).toEqual(GUEST);
    expect(app.live?.count).toBe(0);

    const providerB = userProvider({ id: "u_B", name: "Bob" });
    const resultB = await renderToString(app, { providers: { "http.get": providerB } });
    expect(resultB.snapshot.slots.user).toEqual({ id: "u_B", name: "Bob" });
    expect(resultB.snapshot.slots.count).toBe(0);
  });

  it("records a panic step, with its stack and category, when an SSR reducer throws", async () => {
    captureConsole();
    const result = await renderToString(panickingApp(new Error("boom from userLoaded")), {
      providers: { "http.get": userProvider() },
    });

    const panicStep = result.bootstrapEpisode.steps.find((s) => s.kind === "panic") as
      | { message: string; location?: string; stack?: string; category?: string }
      | undefined;
    expect(panicStep?.message).toContain("boom");
    expect(result.bootstrapEpisode.status).toBe("panic");
    expect(panicStep?.location).toBe(`reducer "userLoaded"`);
    expect(panicStep?.category).toBe("hydrate");
    expect(panicStep?.stack).toMatch(/at .+/);
  });

  it("keeps the Error.cause chain of an SSR reducer panic", async () => {
    captureConsole();
    const error = new Error("boom from userLoaded", { cause: new Error("root disk") });
    const result = await renderToString(panickingApp(error), {
      providers: { "http.get": userProvider() },
    });

    const panicStep = result.bootstrapEpisode.steps.find((s) => s.kind === "panic") as
      | { cause?: Array<{ message: string }> }
      | undefined;
    expect(panicStep?.cause?.[0]?.message).toBe("root disk");
  });

  it("reports an unhandled effect err via console.error", async () => {
    const errors = captureConsole();
    const app = makeSsrApp();
    app.reducers = app.reducers.filter((r) => r.name !== "userFailed");
    await renderToString(app, {
      providers: { "http.get": async () => ({ kind: "err", value: "network" }) },
    });

    expect(errors[0]).toContain("loadUser");
  });

  it("routes a 401 err through app.http.on401 — even with no per-effect .err reducer", async () => {
    const app = makeSsrApp();
    app.reducers = app.reducers.filter((r) => r.name !== "userFailed");
    app.reducers.push({
      name: "loginRequired",
      event: { kind: "lifecycle", name: "loginRequired" },
      apply: () => ({ slots: { user: { id: "redirect", name: "/login" } }, emits: [] }),
    });
    app.http = { on401: "loginRequired" };

    const result = await renderToString(app, {
      providers: {
        "http.get": async () => ({ kind: "err", value: { status: 401, message: "unauthorized" } }),
      },
    });

    expect(result.snapshot.slots.user).toEqual({ id: "redirect", name: "/login" });
    const reducerStep = result.bootstrapEpisode.steps.find(
      (s) => s.kind === "reducer" && (s as { name: string }).name === "loginRequired",
    );
    expect(reducerStep).toBeDefined();
  });

  it("matches dynamic route patterns via routing.parseLocation", async () => {
    const app = makeSsrApp();
    app.routes = [
      {
        pattern: "/posts/:id",
        tile: (): TileNode => ({
          kind: "heading",
          text: `post ${(app.live?.route as { params: { id: string } }).params.id}`,
        }),
      },
      { pattern: "/404", tile: (): TileNode => ({ kind: "heading", text: "not found" }) },
    ];

    const result = await renderToString(app, {
      route: "/posts/abc",
      routing,
      providers: { "http.get": userProvider() },
    });

    expect(result.snapshot.route).toBe("/posts/abc");
    expect(result.bootstrapEpisode.trigger.target).toBe("/posts/abc");
    expect(result.html).toContain("post abc");
    expect(result.html).not.toContain("not found");
  });

  it("falls back to literal route matching when no routing is provided", async () => {
    const app = makeSsrApp();
    app.routes = [
      { pattern: "/static", tile: (): TileNode => ({ kind: "heading", text: "static page" }) },
      { pattern: "/404", tile: (): TileNode => ({ kind: "heading", text: "not found" }) },
    ];

    const result = await renderToString(app, {
      route: "/static",
      providers: { "http.get": userProvider() },
    });
    expect(result.html).toContain("static page");
  });

  it("dispatches app.init emits concurrently, as the live path does", async () => {
    const app = makeSsrApp();
    const order: string[] = [];
    const timed = (name: string, ms: number) => ({
      name,
      cap: "http.get",
      invoke: async () => {
        order.push(`${name}:start`);
        await tick(ms);
        order.push(`${name}:end`);
        return { kind: "ok" as const, value: null };
      },
    });
    app.effects.slowOne = timed("slowOne", 30);
    app.effects.fastTwo = timed("fastTwo", 5);
    app.init = [
      { effect: "slowOne", args: [] },
      { effect: "fastTwo", args: [] },
    ];
    app.reducers = [];

    await renderToString(app);

    expect(order.indexOf("fastTwo:start")).toBeLessThan(order.indexOf("slowOne:end"));
  });
});
