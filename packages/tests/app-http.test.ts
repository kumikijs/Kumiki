// End-to-end coverage for app.http (#78): a compiled program that declares
// `app.http = { base-url, headers, on-401, credentials }` should: (a) thread
// the config into the HTTP effect path so `fetch` sees the merged URL +
// headers, and (b) route a 401 response back into the `on-401` reducer
// without the developer wiring a per-effect `.err` handler for it.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clickByText,
  type FetchCall,
  type FetchDouble,
  readHeader,
  stubFetch,
} from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const APP_HTTP_EXAMPLE = join(here, "..", "examples", "apps", "07-app-http", "app.kumiki");

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for `done()` rather than for a duration. A fixed sleep long enough for
 * the longest chain here — mount → `boot` → storage read → index fetch →
 * `indexIn` → detail fetch — is a number that holds on an idle machine and
 * stops holding on a loaded one; the condition is the thing actually being
 * waited for. Throws on the deadline so a chain that never completes fails
 * where it stalled instead of at whatever assertion came next.
 */
async function waitUntil(done: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await tick(5);
  }
}

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
    let dispose: (() => void) | undefined;
    try {
      // `dispose` is bound before the assertions and released in `finally`: a
      // failing expectation must not leak a mounted app — its router
      // subscription and in-flight effects outlive the test and turn one
      // failure into a run of them.
      ({ dispose } = mount(app, root));
      // Trigger ui.click(LoadBtn) → emit fetchQuote()
      clickByText(root, "Load");
      await tick();
      expect(double.calls.length).toBe(1);
      expect(double.calls[0]?.url).toBe("https://api.example.com/quote");
      expect(readHeader(double.calls[0]?.init.headers, "X-Session")).toBe("anon");
      expect(double.calls[0]?.init.credentials).toBe("include");
    } finally {
      dispose?.();
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
    let dispose: (() => void) | undefined;
    try {
      ({ dispose } = mount(app, root));
      clickByText(root, "Load");
      await tick(60);
      expect((app.live as Record<string, unknown>).session).toBe("anon");
    } finally {
      dispose?.();
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
  let errors: unknown[][];

  beforeEach(() => {
    // The channel the headless tiers decide failure from, captured rather than
    // printed: a thrown header expression and a rejected decode both arrive
    // here, and both would otherwise leave the request assertions intact.
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      // Epoch milliseconds, the representation `Time` has (stdlib.md §2.2.9)
      // and the one the blog's own scenario.json uses. `Decoder.Json(Post)`
      // checks only the JSON syntax at runtime, not the shape, so an ISO string
      // would still reach `.ok`; the test uses the real representation anyway.
      publishedAt: 1737018000000,
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
    let dispose: (() => void) | undefined;
    try {
      ({ dispose } = mount(app, root));
      // Only the `/api/posts/{id}` calls are read, and every one of them must
      // carry the token. The index request `/api/posts` is excluded by URL, not
      // by position: `boot` emits `loadSession()` and `fetchIndex()` in one
      // batch, so the index request may legitimately race the storage read and
      // go out with an empty token. A detail request cannot — it is emitted by
      // `indexIn` on `fetchIndex.ok`, by which time `sessIn` has run.
      const isDetail = (c: FetchCall): boolean => c.url.endsWith(`/api/posts/${postId}`);
      await waitUntil(() => double?.calls.some(isDetail) === true);
      for (const call of double.calls.filter(isDetail)) {
        expect(readHeader(call.init.headers, "Authorization")).toBe("Bearer session-token");
      }
      // The app also has to have worked: a decode failure or a thrown header
      // expression would leave the request assertions above intact and the app
      // broken, and `console.error` is where both of those land.
      expect(errors).toEqual([]);
    } finally {
      dispose?.();
      root.remove();
    }
  });

  it("a login's stored session is read back after a reload", async () => {
    // The round trip: `loginOk` writes the session with `saveSession`, and the
    // next boot's `loadSession` decodes `Session` from the same key. The writer
    // has to store the shape the reader decodes — a stored `Option` wrapper is
    // refused by the reader's `uuid` check, and with no `loadSession.err`
    // reducer that refusal lands on `console.error` and the user is logged out.
    const userId = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
    const app = await loadApp(BLOG_EXAMPLE);
    double = stubFetch((call) =>
      call.url.endsWith("/api/auth/login")
        ? new Response(JSON.stringify({ userId, token: "fresh-token" }))
        : new Response(JSON.stringify([])),
    );
    const mountAt = (path: string): { root: HTMLElement; dispose: () => void } => {
      history.pushState(null, "", path);
      const root = document.createElement("div");
      document.body.appendChild(root);
      const { dispose } = mount(app, root);
      return { root, dispose };
    };
    const first = mountAt("/login");
    try {
      await waitUntil(() => first.root.querySelector("#loginEmail") !== null);
      for (const [id, value] of [
        ["loginEmail", "a@example.com"],
        ["loginPw", "pw"],
      ] as const) {
        const input = first.root.querySelector<HTMLInputElement>(`#${id}`);
        if (!input) throw new Error(`#${id} not found`);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      first.root
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await waitUntil(() => localStorage.getItem("session") !== null);
      expect(JSON.parse(localStorage.getItem("session") ?? "null")).toEqual({
        userId,
        token: "fresh-token",
      });
    } finally {
      first.dispose();
      first.root.remove();
    }

    const second = mountAt("/posts");
    try {
      await waitUntil(() => (second.root.textContent ?? "").includes("Hi, 5c6d7e8f"));
      // Logout removes the key (a key-only write, http.md §6.7.2) rather than
      // storing a `None` the next boot's decode would refuse.
      clickByText(second.root, "Logout");
      await waitUntil(() => localStorage.getItem("session") === null);
      expect(errors).toEqual([]);
    } finally {
      second.dispose();
      second.root.remove();
      history.pushState(null, "", "/");
    }
  });
});
