import type { AppShape, MountedApp } from "@kumikijs/runtime";
import { createEpisodeLogger, hydrate, mount, renderToString } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { memoryStorage } from "./helpers/episode-apps.ts";
import { userApp, userProvider } from "./helpers/ssr-user-app.ts";

function makeApp(): AppShape {
  return userApp([
    {
      name: "started",
      event: { kind: "lifecycle", name: "app.start" },
      apply: () => ({ slots: {}, emits: [] }),
    },
  ]);
}

/** Render `app` on the server, then forget the state that pass left, as a fresh client would. */
async function serverRendered(app: AppShape, provider = userProvider()) {
  const rendered = await renderToString(app, { providers: { "http.get": provider } });
  delete app.live;
  return rendered;
}

describe("hydrate", () => {
  let target: HTMLElement;

  beforeEach(() => {
    target = freshRoot();
  });

  afterEach(() => {
    target.remove();
  });

  it("places the SSR bootstrap as app.episodes()[0] and app.start as [1]", async () => {
    const app = makeApp();
    const rendered = await serverRendered(app);
    const handle = hydrate(app, target, rendered, { episodeLogger: createEpisodeLogger() });

    const eps = handle.episodes();
    expect(eps.length).toBeGreaterThanOrEqual(2);
    expect(eps[0]?.trigger.kind).toBe("ssr.hydrate");
    expect(eps[0]?.id).toBe(rendered.bootstrapEpisode.id);
    expect(eps[1]?.trigger).toMatchObject({ kind: "lifecycle", target: "app.start" });
    handle.dispose();
  });

  it("does not re-fire app.init effects during hydration", async () => {
    const provider = userProvider();
    const app = makeApp();
    const rendered = await serverRendered(app, provider);
    expect(provider).toHaveBeenCalledTimes(1);

    const handle = hydrate(app, target, rendered, { providers: { "http.get": provider } });

    expect(provider).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it("overlays snapshot.slots onto app.live but keeps volatile slots at default", async () => {
    const app = makeApp();
    const rendered = await serverRendered(app);
    expect(rendered.snapshot.slots).not.toHaveProperty("draft");

    const handle = hydrate(app, target, rendered);

    expect(app.live?.user).toEqual({ id: "u_1", name: "Yui" });
    expect(app.live?.draft).toBe("");
    handle.dispose();
  });

  it("keeps episode continuity across hydration → user click → ui.click episode", async () => {
    const app = makeApp();
    const rendered = await serverRendered(app);
    const handle = hydrate(app, target, rendered, { episodeLogger: createEpisodeLogger() });

    (app as MountedApp)._dispatch("inc", {});

    const order = handle.episodes().map((e) => e.trigger.kind);
    expect(order[0]).toBe("ssr.hydrate");
    expect(order.indexOf("ui.click")).toBeGreaterThan(order.indexOf("ssr.hydrate"));
    expect(app.live?.count).toBe(1);
    handle.dispose();
  });

  it("persists the bootstrap episode through the localStorage mirror", async () => {
    const app = makeApp();
    const rendered = await serverRendered(app);
    const { impl: lsImpl, backing } = memoryStorage();
    const logger = createEpisodeLogger({
      localStorage: true,
      localStorageKey: "k.eps",
      localStorageImpl: lsImpl,
    });
    const handle = hydrate(app, target, rendered, { episodeLogger: logger });

    const parsed = JSON.parse(backing.get("k.eps") ?? "[]") as Array<{
      trigger: { kind: string };
      id: string;
    }>;
    expect(parsed[0]?.trigger.kind).toBe("ssr.hydrate");
    expect(parsed[0]?.id).toBe(rendered.bootstrapEpisode.id);
    handle.dispose();
  });

  it("falls back to a cold CSR boot when snapshot.kumiki version mismatches", async () => {
    const provider = userProvider();
    const app = makeApp();
    const rendered = await serverRendered(app, provider);
    const mismatched = {
      ...rendered,
      snapshot: { ...rendered.snapshot, kumiki: 2 as unknown as 1 },
    };

    const handle = hydrate(app, target, mismatched, {
      episodeLogger: createEpisodeLogger(),
      providers: { "http.get": provider },
    });

    expect(handle.episodes()[0]?.trigger.kind).not.toBe("ssr.hydrate");
    // Once for the server pass, once more for the client's own init.
    expect(provider).toHaveBeenCalledTimes(2);
    handle.dispose();
  });

  it("throws when `hydrate: true` is passed without a bootstrap episode", () => {
    expect(() => mount(makeApp(), target, { hydrate: true })).toThrow(/bootstrapEpisode/);
  });

  it("replaces an SSR-prefilled DOM root instead of appending a second tree", async () => {
    const app = makeApp();
    const rendered = await serverRendered(app);
    target.innerHTML = rendered.html;
    expect(target.children.length).toBeGreaterThanOrEqual(1);

    const handle = hydrate(app, target, rendered);

    expect(target.children.length).toBe(1);
    handle.dispose();
  });
});
