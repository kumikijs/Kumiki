import { app } from "@kumikijs/examples";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defined } from "./helpers/defined.ts";
import { loadApp } from "./helpers/load.ts";

const RETRY_EXAMPLE = app("08-http-retry");

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("HTTP retry (#83) — end-to-end", () => {
  let original: typeof fetch | undefined;

  afterEach(() => {
    if (original) globalThis.fetch = original;
  });

  it("retries 5xx until success and reaches the .ok reducer", async () => {
    const app = await loadApp(RETRY_EXAMPLE);
    original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls < 3)
        return new Response("oops", { status: 503, statusText: "Service Unavailable" });
      return new Response(JSON.stringify({ text: "hi", author: "k" }), { status: 200 });
    }) as unknown as typeof fetch;
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      const btn = Array.from(root.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Load"),
      );
      if (!btn) throw new Error("Load button not found");
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // exponential(3, 200ms, 2.0) waits 200ms, then 400ms between attempts.
      await tick(900);
      expect(calls).toBe(3);
      const live = defined(app.live, "the app's live map") as Record<string, { _tag: string }>;
      expect(defined(live.state, "the state slot")._tag).toBe("Loaded");
      dispose();
    } finally {
      root.remove();
    }
  });

  it("does not retry 4xx; surfaces the err on the first attempt", async () => {
    const app = await loadApp(RETRY_EXAMPLE);
    original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response("nope", { status: 404, statusText: "Not Found" });
    }) as unknown as typeof fetch;
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      const btn = Array.from(root.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Load"),
      );
      if (!btn) throw new Error("Load button not found");
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await tick(300);
      expect(calls).toBe(1);
      const live = defined(app.live, "the app's live map") as Record<string, { _tag: string }>;
      expect(defined(live.state, "the state slot")._tag).toBe("Failed");
      dispose();
    } finally {
      root.remove();
    }
  });
});
