import { app } from "@kumikijs/examples";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clickContaining, fill, find, mountApp, tick, waitUntil } from "./helpers/dom.ts";
import { type FetchCall, type FetchDouble, readHeader, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const APP_HTTP_EXAMPLE = app("07-app-http");

describe("app.http", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it("prepends base-url and merges the global header into outgoing requests", async () => {
    const app = await loadApp(APP_HTTP_EXAMPLE);
    double = stubFetch(() => new Response(JSON.stringify({ text: "hi", author: "k" })));
    const { root, handle } = mountApp(app);
    try {
      clickContaining(root, "Load");
      await tick(30);
      expect(double.calls.length).toBe(1);
      expect(double.calls[0]?.url).toBe("https://api.example.com/quote");
      expect(readHeader(double.calls[0]?.init.headers, "X-Session")).toBe("anon");
      expect(double.calls[0]?.init.credentials).toBe("include");
    } finally {
      handle.dispose();
      root.remove();
    }
  });

  it("routes a 401 response through app.http.on-401 even with no per-effect 401 handler", async () => {
    const app = await loadApp(APP_HTTP_EXAMPLE);
    (app.live as Record<string, unknown>).session = "carol";
    double = stubFetch(() => new Response("nope", { status: 401, statusText: "Unauthorized" }));
    const { root, handle } = mountApp(app);
    try {
      clickContaining(root, "Load");
      await tick(60);
      expect((app.live as Record<string, unknown>).session).toBe("anon");
    } finally {
      handle.dispose();
      root.remove();
    }
  });
});

const BLOG_EXAMPLE = app("03-blog");

describe("the blog app's Authorization header", () => {
  let double: FetchDouble | undefined;
  let errors: unknown[][];

  beforeEach(() => {
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
      publishedAt: 1737018000000,
      tags: ["kumiki"],
    };
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
    const { root, handle } = mountApp(app);
    try {
      const isDetail = (c: FetchCall): boolean => c.url.endsWith(`/api/posts/${postId}`);
      await waitUntil(() => double?.calls.some(isDetail) === true);
      for (const call of double.calls.filter(isDetail)) {
        expect(readHeader(call.init.headers, "Authorization")).toBe("Bearer session-token");
      }
      // A decode failure or a thrown header expression would pass the request assertions and land here.
      expect(errors).toEqual([]);
    } finally {
      handle.dispose();
      root.remove();
    }
  });

  it("a login's stored session is read back after a reload", async () => {
    const userId = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
    const app = await loadApp(BLOG_EXAMPLE);
    double = stubFetch((call) =>
      call.url.endsWith("/api/auth/login")
        ? new Response(JSON.stringify({ userId, token: "fresh-token" }))
        : new Response(JSON.stringify([])),
    );
    const mountAt = (path: string): { root: HTMLElement; dispose: () => void } => {
      history.pushState(null, "", path);
      const { root, handle } = mountApp(app);
      return { root, dispose: () => handle.dispose() };
    };
    const first = mountAt("/login");
    try {
      await waitUntil(() => first.root.querySelector("#loginEmail") !== null);
      fill(first.root, "#loginEmail", "a@example.com");
      fill(first.root, "#loginPw", "pw");
      find(first.root, "form").dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
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
      // Logout removes the key rather than storing a `None` the next boot's decode would refuse.
      clickContaining(second.root, "Logout");
      await waitUntil(() => localStorage.getItem("session") === null);
      expect(errors).toEqual([]);
    } finally {
      second.dispose();
      second.root.remove();
      history.pushState(null, "", "/");
    }
  });
});
