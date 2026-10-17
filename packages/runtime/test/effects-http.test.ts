import { httpFetch } from "@kumikijs/runtime";
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
    const v = res.value as { status: number; message: string; body: string };
    expect(v.status).toBe(0);
    expect(v.message).toBe("aborted");
    expect(v.body).toBe("");
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

describe("httpFetch: what each decoder delivers", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** `日本語` is three characters and nine UTF-8 bytes, so a text and its bytes cannot be confused. */
  const NIHONGO = "日本語";
  const NIHONGO_UTF8 = [0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac, 0xe8, 0xaa, 0x9e];

  async function ok(decode: unknown, body: BodyInit | null): Promise<unknown> {
    stubFetch(() => new Response(body, { status: 200 }));
    const res = await httpFetch("GET", { url: "/r", decode });
    expect(res.kind).toBe("ok");
    return res.value;
  }

  it("`Decoder.Bytes` delivers the body's bytes, not its text", async () => {
    const value = await ok("bytes", NIHONGO);
    expect(value).toBeInstanceOf(Uint8Array);
    expect(Array.from(value as Uint8Array)).toEqual(NIHONGO_UTF8);
  });

  // A body that is not UTF-8 at all: read as text, 0xff becomes U+FFFD, so
  // bytes taken from the text would be different bytes.
  it("`Decoder.Bytes` delivers the bytes as received, whatever they encode", async () => {
    const value = await ok("bytes", new Uint8Array([0xff, 0x00, 0x80]));
    expect(Array.from(value as Uint8Array)).toEqual([0xff, 0x00, 0x80]);
  });

  it("`Decoder.Text` delivers the body's text", async () => {
    expect(await ok("text", NIHONGO)).toBe(NIHONGO);
  });

  it("`Decoder.None` delivers Unit without the body", async () => {
    expect(await ok("none", NIHONGO)).toBeNull();
  });

  it("`Decoder.Json`, and a request with no decoder, deliver the parsed body", async () => {
    expect(await ok("json", JSON.stringify({ n: NIHONGO }))).toEqual({ n: NIHONGO });
    expect(await ok(undefined, JSON.stringify([1]))).toEqual([1]);
  });

  // `HttpError.body` is `Text` whatever the request asked to decode a 2xx as.
  it("a non-2xx under `Decoder.Bytes` still carries the body's text", async () => {
    stubFetch(() => new Response(NIHONGO, { status: 404, statusText: "Not Found" }));
    const res = await httpFetch("GET", { url: "/r", decode: "bytes" });
    expect(res).toEqual({
      kind: "err",
      value: { status: 404, message: "Not Found", body: NIHONGO },
    });
  });

  // `map-request` builds an ordinary record, so `decode` can hold any value.
  it("a decode that is no decoder fails the effect, before any request", async () => {
    const { calls } = stubFetch(() => new Response(NIHONGO, { status: 200 }));
    const res = await httpFetch("GET", { url: "/r", decode: "TEXT" });
    expect(calls).toHaveLength(0);
    expect(res).toEqual({
      kind: "err",
      value: { status: 0, message: expect.stringContaining('"TEXT"'), body: "" },
    });
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
