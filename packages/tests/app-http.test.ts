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
