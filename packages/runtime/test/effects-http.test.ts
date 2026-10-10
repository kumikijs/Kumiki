import { type EffectResult, httpFetch } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("httpFetch", () => {
  const originalFetch = globalThis.fetch;

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

  it("normalizes external-signal abort to {status:0, message:'aborted'}", async () => {
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
    const v = res.value as { status: number; message: string; body: unknown };
    expect(v.status).toBe(0);
    expect(v.message).toBe("aborted");
    expect(v.body).toEqual({ _tag: "None" });
  });

  it("returns immediately with aborted when external signal is already aborted", async () => {
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

  it("reports a body stream that errors mid-read as status 0", async () => {
    stubFetch(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.error(new TypeError("stream reset"));
            },
          }),
          { status: 201 },
        ),
    );
    const res = await httpFetch("POST", { url: "/orders" });
    expect(res.kind).toBe("err");
    if (res.kind !== "err") return;
    const v = res.value as { status: number; message: string };
    expect(v.status).toBe(0);
    expect(v.message).toMatch(/stream reset/);
  });

  it("reports an abort during the body read as aborted, not a decode failure", async () => {
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    stubFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              body = c;
            },
          }),
          { status: 200 },
        ),
    );
    const ctl = new AbortController();
    const pending = httpFetch("GET", { url: "/q" }, undefined, ctl.signal);
    while (!body) await new Promise((r) => setTimeout(r, 0));
    ctl.abort();
    body.error(new DOMException("The operation was aborted.", "AbortError"));
    const res = await pending;
    expect(res.kind).toBe("err");
    if (res.kind !== "err") return;
    const v = res.value as { status: number; message: string };
    expect(v.message).toBe("aborted");
    expect(v.message).not.toMatch(/^decode failed/);
    expect(v.status).toBe(0);
  });

  it("reports a body-less 204 under the default decoder as a decode failure with status 204", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    const res = await httpFetch("DELETE", { url: "/orders/1" });
    expect(res.kind).toBe("err");
    if (res.kind !== "err") return;
    const v = res.value as { status: number; message: string };
    expect(v.status).toBe(204);
    expect(v.message).toMatch(/^decode failed/);
  });
});

describe("httpFetch request body", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** A `Multipart` body the way codegen builds it: a Map of tagged FormValues. */
  const multipart = (entries: Record<string, { _tag: string; _0: unknown }>) => ({
    _tag: "Multipart",
    _0: entries,
  });

  it("sends a FileV entry as its File and a BoolV entry as its text", async () => {
    const { calls } = stubFetch(() => new Response("ok"));
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    const res = await httpFetch("POST", {
      url: "/up",
      decode: "text",
      body: multipart({
        doc: { _tag: "FileV", _0: { name: "a.txt", size: 1, type: "text/plain", _file: file } },
        agree: { _tag: "BoolV", _0: true },
      }),
    });
    expect(res.kind).toBe("ok");
    const fd = calls[0]?.init.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("doc")).toBe(file);
    expect(fd.get("agree")).toBe("true");
  });

  it("fails a FileV that holds no file, without making a request", async () => {
    // A file record restored from persistence through JSON has `_file: {}`.
    const { calls } = stubFetch(() => new Response("ok"));
    const res = await httpFetch("POST", {
      url: "/up",
      decode: "text",
      body: multipart({
        doc: { _tag: "FileV", _0: { name: "a.txt", size: 1, type: "text/plain", _file: {} } },
      }),
    });
    expect(calls).toHaveLength(0);
    expect(res.kind).toBe("err");
    if (res.kind !== "err") return;
    const v = res.value as { status: number; message: string };
    expect(v.status).toBe(0);
    expect(v.message).toContain('"doc"');
  });

  it.each(["GET", "HEAD"])("sends no body and no Content-Type for a %s", async (method) => {
    const { calls } = stubFetch(() => new Response(null));
    await httpFetch(method, { url: "/q", body: { _tag: "Json", _0: { a: 1 } } });
    expect(calls[0]?.init.body).toBeUndefined();
    expect(calls[0]?.init.headers).toEqual({});
  });
});

describe("the HttpError's body", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const some = (text: string) => ({ _tag: "Some", _0: text });
  const none = { _tag: "None" };

  /** The `status` and `body` of the HttpError `run` fails with. */
  async function failure(run: Promise<EffectResult>): Promise<{ status: number; body: unknown }> {
    const res = await run;
    if (res.kind !== "err") throw new Error(`expected an err, got ${JSON.stringify(res)}`);
    const { status, body } = res.value as { status: number; body: unknown };
    return { status, body };
  }

  /** A response whose body stream fails as soon as it is read. */
  const unreadable = (status: number) =>
    new Response(
      new ReadableStream({
        start(c) {
          c.error(new TypeError("stream reset"));
        },
      }),
      { status },
    );

  it.each([
    ["a 404 with a body", 404, "report 7 was archived"],
    ["a 404 with an empty body", 404, ""],
    ["a 401", 401, "sign in first"],
    ["a 503", 503, "busy"],
  ])("is Some of what %s sent", async (_, status, text) => {
    stubFetch(() => new Response(text, { status }));
    expect(await failure(httpFetch("GET", { url: "/r" }))).toEqual({ status, body: some(text) });
  });

  it("is Some of the text of a 2xx that does not parse", async () => {
    stubFetch(() => new Response("<html>Created</html>", { status: 201 }));
    expect(await failure(httpFetch("POST", { url: "/orders" }))).toEqual({
      status: 201,
      body: some("<html>Created</html>"),
    });
  });

  it("is Some of the text of a 2xx whose value the declared type refuses", async () => {
    stubFetch(() => new Response('{"name":""}', { status: 200 }));
    const refuseAll = () => ({ kind: "nonempty", args: [], path: [] });
    expect(await failure(httpFetch("GET", { url: "/me", decode: refuseAll }))).toEqual({
      status: 200,
      body: some('{"name":""}'),
    });
  });

  it("is None when a non-2xx's body cannot be read, which keeps its status", async () => {
    stubFetch(() => unreadable(500));
    expect(await failure(httpFetch("GET", { url: "/r" }))).toEqual({ status: 500, body: none });
  });

  it("is None when a 2xx's body cannot be read", async () => {
    stubFetch(() => unreadable(200));
    expect(await failure(httpFetch("GET", { url: "/r" }))).toEqual({ status: 0, body: none });
  });

  it("is None for a network failure", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await failure(httpFetch("GET", { url: "/r" }))).toEqual({ status: 0, body: none });
  });

  it("is None for a timeout", async () => {
    globalThis.fetch = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;
    expect(await failure(httpFetch("GET", { url: "/slow" }, { timeout: 5 }))).toEqual({
      status: 0,
      body: none,
    });
  });

  it("is None for a request body that cannot be sent", async () => {
    stubFetch(() => new Response("ok"));
    const body = {
      _tag: "Multipart",
      _0: { doc: { _tag: "FileV", _0: { name: "a.txt", size: 1, type: "text/plain", _file: {} } } },
    };
    expect(await failure(httpFetch("POST", { url: "/up", body }))).toEqual({
      status: 0,
      body: none,
    });
  });
});
