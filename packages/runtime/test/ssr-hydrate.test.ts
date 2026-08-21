// SSR hydration boundary (docs/spec/runtime.md §10.6.2) — exercises
// `hydrate` end-to-end on a happy-dom DOM. Verifies that:
//   - the bootstrap episode lands at `app.episodes()[0]` BEFORE app.start;
//   - the snapshot.slots overlay reaches the live signal graph but volatile
//     slots stay at their declared default;
//   - the client never re-runs `app.init` (provider stays at 1 invocation);
//   - localStorage mirror picks up the bootstrap on the same persist sweep;
//   - a version-mismatched snapshot is dropped and a normal CSR boot runs.

import type {
  AppShape,
  CapabilityProvider,
  EffectSpec,
  EpisodeLocalStorage,
  TileNode,
} from "@kumikijs/runtime";
import { createEpisodeLogger, hydrate, mount, renderToString } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type User = { id: string; name: string };

function dispatchByName(app: AppShape, name: string, el: Record<string, unknown> = {}): void {
  (app as AppShape & { _dispatch?: (n: string, el: Record<string, unknown>) => void })._dispatch?.(
    name,
    el,
  );
}

function makeApp(httpProvider: CapabilityProvider): AppShape {
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
        // `app.start` lifecycle reducer — runs only on the client (the
        // spec says SSR never fires it). We use it as a sentinel so tests
        // can prove episode continuity (`ssr.hydrate` → `app.start` → …).
        name: "started",
        event: { kind: "lifecycle", name: "app.start" },
        apply: () => ({ slots: {}, emits: [] }),
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
        {
          kind: "button",
          text: "+",
          props: {
            onClick: () => dispatchByName(app, "inc"),
          },
        },
      ],
    }),
  };
  // Marker used by httpProvider invocation counters in some tests — kept off
  // the real shape via `as`.
  (app as { _provider?: CapabilityProvider })._provider = httpProvider;
  return app;
}

function mountTarget(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

/**
 * Drops the map the SSR pass filled in, so the client starts from slot
 * defaults the way a fresh boot would. Behind a function because deleting the
 * property inline would narrow `app.live` to `undefined` for the rest of the
 * test, and every assertion after hydration is about what hydration put back.
 */
function resetLive(app: AppShape): void {
  delete app.live;
}

describe("hydrate §10.6.2", () => {
  let target: HTMLDivElement;

  beforeEach(() => {
    target = mountTarget();
  });

  afterEach(() => {
    target.remove();
  });

  it("places the SSR bootstrap as app.episodes()[0] and app.start as [1]", async () => {
    const provider = vi.fn<CapabilityProvider>(async () => ({
      kind: "ok",
      value: { id: "u_1", name: "Yui" },
    }));
    const app = makeApp(provider);
    const rendered = await renderToString(app, { providers: { "http.get": provider } });

    resetLive(app);
    const logger = createEpisodeLogger();
    const handle = hydrate(app, target, rendered, { episodeLogger: logger });

    const eps = handle.episodes();
    expect(eps.length).toBeGreaterThanOrEqual(2);
    expect(eps[0]?.trigger.kind).toBe("ssr.hydrate");
    expect(eps[0]?.id).toBe(rendered.bootstrapEpisode.id);
    expect(eps[1]?.trigger).toMatchObject({ kind: "lifecycle", target: "app.start" });

    handle.dispose();
  });

  it("does not re-fire app.init effects during hydration", async () => {
    const provider = vi.fn<CapabilityProvider>(async () => ({
      kind: "ok",
      value: { id: "u_1", name: "Yui" },
    }));
    const app = makeApp(provider);
    const rendered = await renderToString(app, { providers: { "http.get": provider } });
    expect(provider).toHaveBeenCalledTimes(1);

    resetLive(app);
    const handle = hydrate(app, target, rendered, { providers: { "http.get": provider } });

    // Provider stays at 1 — hydration is forbidden from re-running app.init.
    expect(provider).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it("overlays snapshot.slots onto app.live but keeps volatile slots at default", async () => {
    const provider = vi.fn<CapabilityProvider>(async () => ({
      kind: "ok",
      value: { id: "u_1", name: "Yui" },
    }));
    const app = makeApp(provider);
    const rendered = await renderToString(app, { providers: { "http.get": provider } });

    // Sanity: the SSR pass put a non-default `user` in the snapshot…
    expect(rendered.snapshot.slots.user).toEqual({ id: "u_1", name: "Yui" });
    // …and the volatile `draft` is absent.
    expect(rendered.snapshot.slots).not.toHaveProperty("draft");

    resetLive(app);
    const handle = hydrate(app, target, rendered);

    expect(app.live?.user).toEqual({ id: "u_1", name: "Yui" });
    // Volatile fell back to its declared default rather than being hydrated.
    expect(app.live?.draft).toBe("");
    handle.dispose();
  });

  it("keeps episode continuity across hydration → user click → ui.click episode", async () => {
    const provider = vi.fn<CapabilityProvider>(async () => ({
      kind: "ok",
      value: { id: "u_1", name: "Yui" },
    }));
    const app = makeApp(provider);
    const rendered = await renderToString(app, { providers: { "http.get": provider } });

    resetLive(app);
    const logger = createEpisodeLogger();
    const handle = hydrate(app, target, rendered, { episodeLogger: logger });

    // Simulate a user click on the IncBtn — the runtime owns `_dispatch`
    // after mount, so we bounce through it like the rendered button does.
    dispatchByName(app, "inc");

    const eps = handle.episodes();
    const order = eps.map((e) => e.trigger.kind);
    expect(order[0]).toBe("ssr.hydrate");
    expect(order).toContain("ui.click");
    // ui.click MUST come strictly after ssr.hydrate + app.start.
    const hydrateIdx = order.indexOf("ssr.hydrate");
    const clickIdx = order.indexOf("ui.click");
    expect(clickIdx).toBeGreaterThan(hydrateIdx);
    expect(app.live?.count).toBe(1);

    handle.dispose();
  });

  it("persists the bootstrap episode through the localStorage mirror", async () => {
    const provider = vi.fn<CapabilityProvider>(async () => ({
      kind: "ok",
      value: { id: "u_1", name: "Yui" },
    }));
    const app = makeApp(provider);
    const rendered = await renderToString(app, { providers: { "http.get": provider } });
    resetLive(app);

    const backing = new Map<string, string>();
    const lsImpl: EpisodeLocalStorage = {
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => {
        backing.set(k, v);
      },
      removeItem: (k) => {
        backing.delete(k);
      },
    };
    const logger = createEpisodeLogger({
      localStorage: true,
      localStorageKey: "k.eps",
      localStorageImpl: lsImpl,
    });
    const handle = hydrate(app, target, rendered, { episodeLogger: logger });

    const raw = backing.get("k.eps");
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw ?? "[]") as Array<{ trigger: { kind: string }; id: string }>;
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0]?.trigger.kind).toBe("ssr.hydrate");
    expect(parsed[0]?.id).toBe(rendered.bootstrapEpisode.id);
    handle.dispose();
  });

  it("falls back to a cold CSR boot when snapshot.kumiki version mismatches", async () => {
    const provider = vi.fn<CapabilityProvider>(async () => ({
      kind: "ok",
      value: { id: "u_1", name: "Yui" },
    }));
    const app = makeApp(provider);
    const rendered = await renderToString(app, { providers: { "http.get": provider } });
    // Sabotage the snapshot version so hydrate() is forced to fall back.
    const mismatched = {
      ...rendered,
      snapshot: { ...rendered.snapshot, kumiki: 2 as unknown as 1 },
    };

    resetLive(app);
    const logger = createEpisodeLogger();
    const handle = hydrate(app, target, mismatched, {
      episodeLogger: logger,
      providers: { "http.get": provider },
    });

    const eps = handle.episodes();
    // The first episode is NOT ssr.hydrate — the snapshot was dropped.
    expect(eps[0]?.trigger.kind).not.toBe("ssr.hydrate");
    // CSR ran app.init normally, so the provider fired a SECOND time
    // (once for SSR, once for the fallback boot).
    expect(provider).toHaveBeenCalledTimes(2);
    handle.dispose();
  });

  it("throws when `hydrate: true` is passed without a bootstrap episode", () => {
    const provider = vi.fn<CapabilityProvider>(async () => ({
      kind: "ok",
      value: { id: "u_1", name: "Yui" },
    }));
    const app = makeApp(provider);
    expect(() =>
      mount(app, target, {
        // The shape that previously slipped through: hydrate flag on, but no
        // bootstrap. Now a hard error so the silent state machine can't form.
        hydrate: true,
      }),
    ).toThrow(/bootstrapEpisode/);
  });

  it("replaces an SSR-prefilled DOM root instead of appending a second tree", async () => {
    const provider = vi.fn<CapabilityProvider>(async () => ({
      kind: "ok",
      value: { id: "u_1", name: "Yui" },
    }));
    const app = makeApp(provider);
    const rendered = await renderToString(app, { providers: { "http.get": provider } });

    // Inject SSR HTML the way a real host would (a `target.innerHTML = html`
    // happens before hydrate). Without the §10.6.2 replaceChildren guard,
    // the runtime appends a SECOND root — leaving two sibling trees.
    target.innerHTML = rendered.html;
    expect(target.children.length).toBeGreaterThanOrEqual(1);

    resetLive(app);
    const handle = hydrate(app, target, rendered);
    // Exactly one root after hydration — the SSR tree was replaced wholesale.
    expect(target.children.length).toBe(1);
    handle.dispose();
  });
});
