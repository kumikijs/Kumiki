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

  it("merges headers with precedence auto < global < input", async () => {
    const { calls } = stubFetch(() => new Response("ok", { status: 200 }));
    await httpFetch(
      "POST",
      {
        url: "/x",
        headers: { "x-user": "input-wins", "content-type": "application/xml" },
        body: { hello: "world" },
      },
      {
        headers: () => ({ "X-User": "global-loses", "X-Global": "yes", ACCEPT: "text/x-global" }),
      },
    );
    expect(calls[0]?.init.headers).toEqual({
      ACCEPT: "text/x-global",
      "content-type": "application/xml",
      "x-user": "input-wins",
      "X-Global": "yes",
    });
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

describe("httpFetch base-url", () => {
  const originalFetch = globalThis.fetch;
  const API = "https://api.example.com";

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function fetched(
    url: unknown,
    baseUrl?: string,
    query?: Record<string, string>,
  ): Promise<string | undefined> {
    const { calls } = stubFetch(() => new Response("null"));
    await httpFetch("GET", { url, query }, baseUrl === undefined ? undefined : { baseUrl });
    return calls[0]?.url;
  }

  it.each([
    [API, "/items/1", `${API}/items/1`],
    [API, "items/1", `${API}/items/1`],
    [`${API}/`, "/items/1", `${API}/items/1`],
    [`${API}/`, "items/1", `${API}/items/1`],
    [`${API}//`, "items/1", `${API}/items/1`],
    [API, "items/1?next=https://cdn.other.org", `${API}/items/1?next=https://cdn.other.org`],
    [API, "items/1#top", `${API}/items/1#top`],
    [API, "/users:search", `${API}/users:search`],
    [API, "1a:b", `${API}/1a:b`],
    [API, "a_b:c", `${API}/a_b:c`],
    ["/", "users", "/users"],
    ["/", "/users", "/users"],
  ])("joins %s and %s with exactly one /", async (base, url, want) => {
    expect(await fetched(url, base)).toBe(want);
  });

  it.each([
    "https://cdn.other.org/item.json",
    "HTTP://cdn.other.org/item.json",
    "//cdn.other.org/item.json",
    "data:application/json,null",
    "git+ssh://host/x",
    "s3://bucket/key",
    "a:b",
    "users:search",
  ])("fetches the absolute url %s as written, whichever way the base ends", async (url) => {
    expect(await fetched(url, API)).toBe(url);
    expect(await fetched(url, `${API}/`)).toBe(url);
  });

  it.each([
    [`${API}/v1`, "/users", `${API}/v1/users`],
    [`${API}/v1`, "users", `${API}/v1/users`],
    [`${API}/v1/`, "/users", `${API}/v1/users`],
    ["/api", "users", "/api/users"],
    ["/api/", "/users", "/api/users"],
  ])("keeps the path of the base %s in front of %s", async (base, url, want) => {
    expect(await fetched(url, base)).toBe(want);
  });

  it.each([
    [`${API}/items`, "", `${API}/items`],
    [`${API}/items`, "?page=2", `${API}/items?page=2`],
    [`${API}/items`, "#top", `${API}/items#top`],
    [`${API}/items/`, "", `${API}/items/`],
    [`${API}/items/`, "?page=2", `${API}/items/?page=2`],
  ])("appends %j to the base %s as written", async (base, url, want) => {
    expect(await fetched(url, base)).toBe(want);
  });

  it.each([
    [`${API}/search?q=`, "term", `${API}/search?q=term`],
    [`${API}/search?q=`, "/term", `${API}/search?q=/term`],
    [
      "https://proxy.example.com/?url=",
      "https://target/x",
      "https://proxy.example.com/?url=https://target/x",
    ],
    [`${API}/page#`, "top", `${API}/page#top`],
  ])("appends the url to the base %s, which carries a ? or a #, as written", async (base, url, want) => {
    expect(await fetched(url, base)).toBe(want);
  });

  it.each([
    "/items/1",
    "items/1",
    "https://cdn.other.org/item.json",
  ])("fetches %s as written with no base-url, or an empty one", async (url) => {
    expect(await fetched(url)).toBe(url);
    expect(await fetched(url, "")).toBe(url);
  });

  it("joins a url that is not text as its text, and makes the request", async () => {
    expect(await fetched(42, API)).toBe(`${API}/42`);
    expect(await fetched(42)).toBe("42");
  });

  it("appends the query after the join", async () => {
    expect(await fetched("/search", `${API}/`, { q: "a b" })).toBe(`${API}/search?q=a+b`);
  });
});

describe("httpFetch global headers and credentials under a base-url", () => {
  const originalFetch = globalThis.fetch;
  const API = "https://api.example.com";

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** What the request to `url` carried of the program's global `headers` and `credentials`. */
  async function carried(url: string, baseUrl?: string, own?: Record<string, string>) {
    const { calls } = stubFetch(() => new Response("null"));
    await httpFetch(
      "GET",
      { url, headers: own },
      {
        ...(baseUrl === undefined ? {} : { baseUrl }),
        headers: () => ({ Authorization: "Bearer t" }),
        credentials: "include",
      },
    );
    const init = calls[0]?.init ?? {};
    // `Accept` is the runtime's own default, not the program's.
    const { Accept, ...headers } = (init.headers ?? {}) as Record<string, string>;
    expect(Accept).toBe("application/json");
    return { headers, credentials: init.credentials };
  }

  it.each([
    [API, "/items"],
    [API, "items"],
    [`${API}/`, "https://api.example.com/other"],
    [`${API}/v1`, "/users"],
    [`${API}/search?q=`, "term"],
    ["/api", "users"],
  ])("sends them under the base %s with %s, on the base's origin", async (base, url) => {
    expect(await carried(url, base)).toEqual({
      headers: { Authorization: "Bearer t" },
      credentials: "include",
    });
  });

  it.each([
    [API, "https://cdn.other.org/x"],
    [API, "//cdn.other.org/x"],
    [API, "http://api.example.com/x"],
    [API, "https://api.example.com:8443/x"],
    ["/api", "https://cdn.other.org/x"],
  ])("sends neither under the base %s with %s, on another origin", async (base, url) => {
    expect(await carried(url, base)).toEqual({ headers: {}, credentials: "same-origin" });
  });

  it("sends neither when the base names no origin it can be read as", async () => {
    expect(await carried("/x", "https://exa mple.com")).toEqual({
      headers: {},
      credentials: "same-origin",
    });
  });

  it("still sends a request's own headers to another origin", async () => {
    expect(await carried("https://cdn.other.org/x", API, { "X-Key": "k" })).toEqual({
      headers: { "X-Key": "k" },
      credentials: "same-origin",
    });
  });

  it("sends them with every request when there is no base-url", async () => {
    for (const base of [undefined, ""]) {
      expect(await carried("https://cdn.other.org/x", base)).toEqual({
        headers: { Authorization: "Bearer t" },
        credentials: "include",
      });
    }
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

  it("drops only the Content-Type of a Multipart body, keeping Accept and the global headers", async () => {
    const { calls } = stubFetch(() => new Response("{}"));
    await httpFetch(
      "POST",
      {
        url: "/up",
        decode: "json",
        headers: { "content-type": "multipart/form-data" },
        body: multipart({ agree: { _tag: "BoolV", _0: true } }),
      },
      { headers: () => ({ Authorization: "Bearer t" }) },
    );
    expect(calls[0]?.init.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer t",
    });
  });

  it.each([
    ["the effect's", { "Content-Type": undefined }, undefined],
    ["a global", undefined, { "Content-Type": undefined }],
  ])("keeps the default Content-Type when %s value for it is undefined", async (_, own, global) => {
    // The types rule this out, but a field a predicate-free `Decoder.Json(T)` let through
    // missing reaches the handler as `undefined`.
    const { calls } = stubFetch(() => new Response("{}"));
    await httpFetch(
      "POST",
      {
        url: "/x",
        headers: own as unknown as Record<string, string> | undefined,
        body: { _tag: "Json", _0: { a: 1 } },
      },
      global ? { headers: () => global as unknown as Record<string, string> } : undefined,
    );
    expect(calls[0]?.init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
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
    expect(calls[0]?.init.headers).toEqual({ Accept: "application/json" });
  });

  it.each([
    ["no decoder", undefined, { Accept: "application/json" }],
    ["Decoder.Json(T) as the sentinel", "json", { Accept: "application/json" }],
    ["Decoder.Json(T) as a check", () => undefined, { Accept: "application/json" }],
    ["Decoder.Text", "text", {}],
    ["Decoder.Bytes", "bytes", {}],
    ["Decoder.None", "none", {}],
  ])("sends the Accept that %s implies", async (_, decode, expected) => {
    const { calls } = stubFetch(() => new Response("null"));
    await httpFetch("GET", { url: "/q", decode });
    expect(calls[0]?.init.headers).toEqual(expected);
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
