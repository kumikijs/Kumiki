// `app.http`'s value fields are expressions, and an expression may read a
// slot. `headers` was lowered into a thunk and worked; `base-url`, `timeout`
// and `credentials` were lowered as values into `const _http = {…}`, which the
// module emits before `_live` exists — so a slot reference there was a
// `ReferenceError` at import and nothing mounted at all.
//
// What is pinned here is not that the module loads. It is *when* each field is
// read: the value that reaches `fetch` is the slot's value at the moment of
// the request, not at construction. A fix that only reordered the emission
// would load, mount, and freeze every field at its declared default — which
// looks identical until the slot changes. So every field is moved by a reducer
// between two requests, through the language's own write path.
//
// Coverage of the literal case lives elsewhere, and is a different guarantee
// in each place: `packages/compiler/test/app-http.test.ts` asserts the emitted
// shape of all four fields on inline source, and the sibling
// `packages/tests/app-http.test.ts` mounts `07-app-http` and asserts the URL,
// one header and `credentials` reach `fetch` — not `timeout`, which is pinned
// end-to-end only here.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickByText, type FetchDouble, readHeader, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "81-http-config-from-slots.kumiki");

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("app.http fields that read a slot", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it("reaches fetch with each slot's value, and follows the slots between requests", async () => {
    const app = await loadApp(EXAMPLE);
    double = stubFetch(() => new Response("a quote"));
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);

      clickByText(root, "Load quote");
      await tick();
      expect(double.calls.map((c) => c.url)).toEqual(["https://api.example.com/quote"]);
      expect(double.calls[0]?.init.credentials).toBe("include");
      expect(readHeader(double.calls[0]?.init.headers, "X-Endpoint")).toBe(
        "https://api.example.com",
      );

      // Two reducers, writing three of the four slots and nothing else. If a
      // field were read once, this request would repeat the first one.
      clickByText(root, "Use backup");
      clickByText(root, "Tighten");
      clickByText(root, "Load quote");
      await tick();
      expect(double.calls.map((c) => c.url)).toEqual([
        "https://api.example.com/quote",
        "https://backup.example.com/quote",
      ]);
      expect(double.calls[1]?.init.credentials).toBe("omit");
      expect(readHeader(double.calls[1]?.init.headers, "X-Endpoint")).toBe(
        "https://backup.example.com",
      );

      dispose();
    } finally {
      root.remove();
    }
  });

  it("arms the abort with the timeout slot's current value", async () => {
    // The fourth field, through the same write path. `httpFetch` arms
    // `setTimeout(abort, timeout)` per request, so a request that is never
    // answered ends as an `err` — and reaches the `failed` reducer — only if
    // the abort was armed with the 20ms the reducer wrote rather than with the
    // 5s the slot was declared with.
    const app = await loadApp(EXAMPLE);
    // A request that only ends when the abort arrives. A stub that ignored
    // `init.signal` would hang instead, and the assertion below would fail for
    // a reason that has nothing to do with the timeout.
    double = stubFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          });
        }),
    );
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);

      clickByText(root, "Tighten");
      clickByText(root, "Load quote");
      await tick(300);

      expect((app.live as Record<string, unknown>).status).toBe("error");
      dispose();
    } finally {
      root.remove();
    }
  });
});
