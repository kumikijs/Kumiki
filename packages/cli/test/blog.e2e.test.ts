import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAndLoad } from "./helpers/build-and-load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const BLOG = resolve(here, "../../examples/apps/03-blog/app.kumiki");

const flush = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

// The ids are uuids because the blog declares them so (`PostId` / `UserId` are
// `nominal Text where uuid`), and a refinement inside a type is checked where
// it is written (language.md §1.3.3): a `Map(PostId, …)` keyed by "p001"
// refuses every write, so the index would never render.
const P1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const P2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function mockFetch(): void {
  const fixtures: Record<string, unknown> = {
    "/api/posts": [P1, P2],
    [`/api/posts/${P1}`]: {
      id: P1,
      title: "Hello Kumiki",
      body: "Hello body content",
      authorId: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
      publishedAt: 1779000000000,
      tags: ["intro"],
    },
    [`/api/posts/${P2}`]: {
      id: P2,
      title: "Routing demo",
      body: "Routing body content",
      authorId: "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
      publishedAt: 1779050000000,
      tags: ["routing"],
    },
  };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url, "http://localhost").pathname;
    if (path in fixtures) {
      return new Response(JSON.stringify(fixtures[path]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("blog e2e (built from .kumiki)", () => {
  let root: HTMLElement;
  const rootId = "blog-root";
  let disposers: Array<{ dispose: () => void }> = [];

  // Dispose every mount so its timers / route listeners don't leak into the
  // next test (same cross-test isolation guard as the TodoMVC suite).
  function track(d: { dispose: () => void }): { dispose: () => void } {
    disposers.push(d);
    return d;
  }

  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", "/posts");
    root = document.createElement("div");
    root.id = rootId;
    document.body.appendChild(root);
    mockFetch();
  });

  afterEach(() => {
    for (const d of disposers) d.dispose();
    disposers = [];
    document.body.removeChild(root);
  });

  it("compiles the blog SPA cleanly", async () => {
    const app = await buildAndLoad(BLOG, rootId);
    expect(app.routes).toBeDefined();
    expect(app.themes).toBeDefined();
  });

  it("redirects / → /posts on mount", async () => {
    history.replaceState(null, "", "/");
    const app = await buildAndLoad(BLOG, rootId);
    track(mount(app, root));
    expect(location.pathname).toBe("/posts");
  });

  it("renders /about static page", async () => {
    history.replaceState(null, "", "/about");
    const app = await buildAndLoad(BLOG, rootId);
    track(mount(app, root));
    const text = root.textContent ?? "";
    expect(text).toContain("About");
  });

  it("fetches post index and renders titles after the requests settle", async () => {
    history.replaceState(null, "", "/posts");
    const app = await buildAndLoad(BLOG, rootId);
    track(mount(app, root));
    // Let the effect dispatcher launch fetchIndex → fetchPost for each id.
    await flush(30);
    await flush(30);
    const titles = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('[data-kumiki-tile="link"]'),
    ).map((a) => a.textContent ?? "");
    expect(titles).toContain("Hello Kumiki");
    expect(titles).toContain("Routing demo");
  });

  it("clicking a post title navigates to /posts/:id without full reload", async () => {
    history.replaceState(null, "", "/posts");
    const app = await buildAndLoad(BLOG, rootId);
    track(mount(app, root));
    await flush(30);
    await flush(30);
    const link = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('[data-kumiki-tile="link"]'),
    ).find((a) => a.textContent === "Hello Kumiki");
    expect(link).toBeDefined();
    link?.click();
    expect(location.pathname).toBe(`/posts/${P1}`);
    expect(app.live?.route).toMatchObject({ pattern: "/posts/:id" });
  });

  it("unknown route lands on /404", async () => {
    history.replaceState(null, "", "/something/that/does/not/exist");
    const app = await buildAndLoad(BLOG, rootId);
    track(mount(app, root));
    expect((app.live?.route as { pattern: string }).pattern).toBe("/404");
    expect(root.textContent ?? "").toContain("404");
  });

  it("theme tokens reach DOM (background / color)", async () => {
    history.replaceState(null, "", "/posts");
    const app = await buildAndLoad(BLOG, rootId);
    track(mount(app, root));
    await flush(30);
    // The Nav row uses bg: "surface" — should be set to theme.colors.surface.
    const surfaces = Array.from(root.querySelectorAll<HTMLElement>('[data-kumiki-tile="row"]'))
      .map((el) => el.style.background)
      .filter(Boolean);
    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces[0]).toBeTruthy();
  });
});
