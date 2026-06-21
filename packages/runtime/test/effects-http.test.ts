// httpFetch unit coverage for app.http (#78): base-url prepend, header
// precedence (auto < global < input), credentials, and timeout via
// AbortController. Each test stubs `globalThis.fetch` so no network is touched.

import { httpFetch } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchCall = { url: string; init: RequestInit };

function stubFetch(responder: (call: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const call: FetchCall = { url: String(url), init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { calls };
}

describe("httpFetch (#78)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Snapshot the real fetch so per-test stubs don't leak.
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("prepends base-url to the request URL", async () => {
    const { calls } = stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await httpFetch("GET", { url: "/quote" }, { baseUrl: "https://api.example.com" });
    expect(calls[0]?.url).toBe("https://api.example.com/quote");
  });

  it("merges headers with precedence auto < global < input", async () => {
    const { calls } = stubFetch(() => new Response("ok", { status: 200 }));
    await httpFetch(
      "POST",
      {
        url: "/x",
        headers: { "X-User": "input-wins", "Content-Type": "application/xml" },
        body: { hello: "world" },
      },
      {
        headers: () => ({ "X-User": "global-loses", "X-Global": "yes" }),
      },
    );
    const sent = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(sent["X-User"]).toBe("input-wins");
    expect(sent["X-Global"]).toBe("yes");
    expect(sent["Content-Type"]).toBe("application/xml");
  });

  it("threads credentials default same-origin and respects override", async () => {
    const { calls } = stubFetch(() => new Response("ok", { status: 200 }));
    await httpFetch("GET", { url: "/a" }, undefined);
    expect(calls[0]?.init.credentials).toBe("same-origin");

    await httpFetch("GET", { url: "/b" }, { credentials: "include" });
    expect(calls[1]?.init.credentials).toBe("include");
  });

  it("returns err with status when the response is 401", async () => {
    stubFetch(() => new Response("nope", { status: 401, statusText: "Unauthorized" }));
    const res = await httpFetch("GET", { url: "/secret" }, { baseUrl: "https://x" });
    expect(res.kind).toBe("err");
    if (res.kind !== "err") return;
    const v = res.value as { status: number; message: string };
    expect(v.status).toBe(401);
  });

  it("aborts after timeout", async () => {
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as unknown as typeof fetch;
    const res = await httpFetch("GET", { url: "/slow" }, { baseUrl: "https://x", timeout: 5 });
    expect(res.kind).toBe("err");
    if (res.kind !== "err") return;
    const v = res.value as { message: string };
    expect(v.message).toMatch(/aborted/i);
  });

  // issue #102 — http.cancel + EffectId returned at emit time.
  it("normalizes external-signal abort to {status:0, message:'aborted'} (#102)", async () => {
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;
    const ctl = new AbortController();
    // Abort right after the call so the awaiting fetch sees the external abort.
    setTimeout(() => ctl.abort(), 0);
    const res = await httpFetch(
      "GET",
      { url: "/q" },
      { baseUrl: "https://x", timeout: 30_000 },
      ctl.signal,
    );
    expect(res.kind).toBe("err");
    if (res.kind !== "err") return;
    const v = res.value as { status: number; message: string; body: string };
    expect(v.status).toBe(0);
    expect(v.message).toBe("aborted");
    expect(v.body).toBe("");
  });

  it("returns immediately with aborted when external signal is already aborted (#102)", async () => {
    // fetch is never called for an already-aborted signal — but if it is, it
    // must still resolve to the aborted shape.
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        if (init?.signal?.aborted) reject(new Error("aborted"));
      });
    }) as unknown as typeof fetch;
    const ctl = new AbortController();
    ctl.abort();
    const res = await httpFetch("GET", { url: "/q" }, undefined, ctl.signal);
    expect(res.kind).toBe("err");
    if (res.kind !== "err") return;
    const v = res.value as { message: string };
    expect(v.message).toBe("aborted");
  });
});
