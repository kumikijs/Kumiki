// End-to-end coverage for app.http (#78): a compiled program that declares
// `app.http = { base-url, headers, on-401, credentials }` should: (a) thread
// the config into the HTTP effect path so `fetch` sees the merged URL +
// headers, and (b) route a 401 response back into the `on-401` reducer
// without the developer wiring a per-effect `.err` handler for it.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickByText, type FetchDouble, readHeader, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const APP_HTTP_EXAMPLE = join(here, "..", "examples", "apps", "07-app-http", "app.kumiki");

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("app.http (#78) — end-to-end", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it("prepends base-url and merges the global header into outgoing requests", async () => {
    const app = await loadApp(APP_HTTP_EXAMPLE);
    double = stubFetch(() => new Response(JSON.stringify({ text: "hi", author: "k" })));
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      // Trigger ui.click(LoadBtn) → emit fetchQuote()
      clickByText(root, "Load");
      await tick();
      expect(double.calls.length).toBe(1);
      expect(double.calls[0]?.url).toBe("https://api.example.com/quote");
      expect(readHeader(double.calls[0]?.init.headers, "X-Session")).toBe("anon");
      expect(double.calls[0]?.init.credentials).toBe("include");
      dispose();
    } finally {
      root.remove();
    }
  });

  it("routes a 401 response through app.http.on-401 even with no per-effect 401 handler", async () => {
    const app = await loadApp(APP_HTTP_EXAMPLE);
    // Pre-set session so the on-401 reducer's `session := "anon"` is observable.
    (app.live as Record<string, unknown>).session = "carol";
    double = stubFetch(() => new Response("nope", { status: 401, statusText: "Unauthorized" }));
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      clickByText(root, "Load");
      await tick(60);
      expect((app.live as Record<string, unknown>).session).toBe("anon");
      dispose();
    } finally {
      root.remove();
    }
  });
});

// #340: `app.http.headers` may hold a `fmt` call, and the blog app's does —
// `fmt("Bearer {0}", session.map($1.token).get-or(""))`. `fmt` substituted
// nothing, so every request that app made carried the literal
// `Authorization: Bearer {0}` and the token never left the browser. Nothing in
// `check`, `build` or `smoke` could see it: a header is a `Text` either way,
// and no tier read what the header said. This one reads it.
const BLOG_EXAMPLE = join(here, "..", "examples", "apps", "03-blog", "app.kumiki");

describe("the blog app's Authorization header (#340)", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
    localStorage.removeItem("session");
  });

  it("carries the stored session's token, not the template", async () => {
    const postId = "9f1c2a54-0e2b-4d6e-9a71-1b2c3d4e5f60";
    const post = {
      id: postId,
      title: "Seven layers, one file",
      body: "Every definition stands on its own.",
      authorId: "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
      publishedAt: "2026-01-15T09:00:00.000Z",
      tags: ["kumiki"],
    };
    // What `loadSession` reads at boot: the storage handler JSON.parses the
    // entry and hands it back as `Some(...)`, which `sessIn` writes to `session`.
    localStorage.setItem(
      "session",
      JSON.stringify({ userId: post.authorId, token: "session-token" }),
    );
    const app = await loadApp(BLOG_EXAMPLE);
    double = stubFetch((call) =>
      call.url.endsWith("/api/posts")
        ? new Response(JSON.stringify([postId]))
        : new Response(JSON.stringify(post)),
    );
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      // Boot restores the session and loads the index; the index then fetches
      // each post it named, and that request is the one made with a session in
      // hand. Asserted on the last call rather than the first: the very first
      // request races the storage read on purpose — an app that has not logged
      // in yet sends `Bearer `, which is the empty-token case, not this one.
      await tick(80);
      const detail = double.calls.filter((c) => c.url.endsWith(`/api/posts/${postId}`));
      expect(detail.length).toBeGreaterThan(0);
      for (const call of detail) {
        expect(readHeader(call.init.headers, "Authorization")).toBe("Bearer session-token");
      }
      dispose();
    } finally {
      root.remove();
    }
  });
});
