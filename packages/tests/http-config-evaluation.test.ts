// `app.http`'s scalar fields are expressions, and an expression may read a
// slot. `headers` was lowered into a thunk and worked; `base-url`, `timeout`
// and `credentials` were lowered as values into `const _http = {…}`, which the
// module emits before `_live` exists — so a slot reference there was a
// `ReferenceError` at import and nothing mounted at all.
//
// What is pinned here is not that the module loads. It is *when* each field is
// read: the value that reaches `fetch` is the slot's value at the moment of
// the request, not at construction. A fix that only reordered the emission
// would load, mount, and freeze every field at its declared default — which
// looks identical until the slot changes.
//
// The literal case keeps its own coverage in app-http.test.ts, which asserts
// the same fields on `07-app-http`, where all three are written as literals.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "81-http-config-from-slots.kumiki");

type FetchCall = { url: string; init: RequestInit };

function stubFetch(): { calls: FetchCall[]; original: typeof fetch } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    // happy-dom hands the stub a Request; the runtime's own unit tests pass a
    // string. Same normalisation as app-http.test.ts.
    const u = typeof url === "string" ? url : (url as Request).url;
    calls.push({ url: u, init: init ?? {} });
    return new Response("a quote");
  }) as unknown as typeof fetch;
  return { calls, original };
}

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

function clickByText(root: HTMLElement, text: string): void {
  const btn = Array.from(root.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("app.http fields that read a slot", () => {
  let original: typeof fetch | undefined;

  afterEach(() => {
    if (original) globalThis.fetch = original;
  });

  it("reaches fetch with the slot's value, and follows the slot between requests", async () => {
    const app = await loadApp(EXAMPLE);
    const stub = stubFetch();
    original = stub.original;
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);

      clickByText(root, "Load quote");
      await tick();
      expect(stub.calls.map((c) => c.url)).toEqual(["https://api.example.com/quote"]);
      expect(stub.calls[0]?.init.credentials).toBe("include");

      // The reducer writes the `endpoint` slot and nothing else. If the field
      // were read once, this request would go to the first host again.
      clickByText(root, "Use backup");
      clickByText(root, "Load quote");
      await tick();
      expect(stub.calls.map((c) => c.url)).toEqual([
        "https://api.example.com/quote",
        "https://backup.example.com/quote",
      ]);

      dispose();
    } finally {
      root.remove();
    }
  });

  it("answers the current slot value for timeout, which a request would read", async () => {
    // A timeout is only observable as a race, so the assertion is on the
    // config object the runtime hands to `httpFetch` on every request — which
    // is where `timeout` is read, at the moment it is read.
    const app = await loadApp(EXAMPLE);
    const http = app.http as { timeout?: number; baseUrl?: string; credentials?: string };
    expect(http.timeout).toBe(5000);
    expect(http.baseUrl).toBe("https://api.example.com");
    expect(http.credentials).toBe("include");

    const live = app.live as Record<string, unknown>;
    live.timeoutMs = 250;
    live.sendCookies = "omit";
    expect(http.timeout).toBe(250);
    expect(http.credentials).toBe("omit");
  });
});
