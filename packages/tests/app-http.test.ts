// End-to-end coverage for app.http (#78): a compiled program that declares
// `app.http = { base-url, headers, on-401, credentials }` should: (a) thread
// the config into the HTTP effect path so `fetch` sees the merged URL +
// headers, and (b) route a 401 response back into the `on-401` reducer
// without the developer wiring a per-effect `.err` handler for it.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const APP_HTTP_EXAMPLE = join(here, "..", "examples", "apps", "07-app-http", "app.kumiki");

type FetchCall = { url: string; init: RequestInit };

function stubFetch(responder: (call: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
  original: typeof fetch;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    // happy-dom calls our stub with a Request object, not a raw string; the
    // bare unit tests in packages/runtime hit the same fn with a string.
    const u = typeof url === "string" ? url : (url as Request).url;
    const call: FetchCall = { url: u, init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { calls, original };
}

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readHeader(h: HeadersInit | undefined, name: string): string | null {
  if (!h) return null;
  if (h instanceof Headers) return h.get(name);
  if (Array.isArray(h)) {
    for (const [k, v] of h) if (k === name) return v;
    return null;
  }
  return (h as Record<string, string>)[name] ?? null;
}

describe("app.http (#78) — end-to-end", () => {
  let original: typeof fetch | undefined;

  afterEach(() => {
    if (original) globalThis.fetch = original;
  });

  it("prepends base-url and merges the global header into outgoing requests", async () => {
    const app = await loadApp(APP_HTTP_EXAMPLE);
    const stub = stubFetch(() => new Response(JSON.stringify({ text: "hi", author: "k" })));
    original = stub.original;
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      // Trigger ui.click(LoadBtn) → emit fetchQuote()
      const btn = Array.from(root.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Load"),
      );
      if (!btn) throw new Error("Load button not found");
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await tick();
      expect(stub.calls.length).toBe(1);
      expect(stub.calls[0]?.url).toBe("https://api.example.com/quote");
      expect(readHeader(stub.calls[0]?.init.headers, "X-Session")).toBe("anon");
      expect(stub.calls[0]?.init.credentials).toBe("include");
      dispose();
    } finally {
      root.remove();
    }
  });

  it("routes a 401 response through app.http.on-401 even with no per-effect 401 handler", async () => {
    const app = await loadApp(APP_HTTP_EXAMPLE);
    // Pre-set session so the on-401 reducer's `session := "anon"` is observable.
    (app.live as Record<string, unknown>).session = "carol";
    const stub = stubFetch(() => new Response("nope", { status: 401, statusText: "Unauthorized" }));
    original = stub.original;
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      const btn = Array.from(root.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Load"),
      );
      if (!btn) throw new Error("Load button not found");
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await tick(60);
      expect((app.live as Record<string, unknown>).session).toBe("anon");
      dispose();
    } finally {
      root.remove();
    }
  });
});
