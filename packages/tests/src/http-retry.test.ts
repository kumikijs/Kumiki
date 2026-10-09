import { app } from "@kumikijs/examples";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { clickContaining, mountApp, tick } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const RETRY_EXAMPLE = app("08-http-retry");

describe("HTTP retry", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it.each([
    {
      name: "retries 5xx until success and reaches the .ok reducer",
      respond: (n: number) =>
        n < 3
          ? new Response("oops", { status: 503, statusText: "Service Unavailable" })
          : new Response(JSON.stringify({ text: "hi", author: "k" }), { status: 200 }),
      // exponential(3, 200ms, 2.0) waits 200ms, then 400ms between attempts.
      waitMs: 900,
      calls: 3,
      state: "Loaded",
    },
    {
      name: "does not retry 4xx; surfaces the err on the first attempt",
      respond: () => new Response("nope", { status: 404, statusText: "Not Found" }),
      waitMs: 300,
      calls: 1,
      state: "Failed",
    },
  ])("$name", async ({ respond, waitMs, calls, state }) => {
    const app = await loadApp(RETRY_EXAMPLE);
    const fetched = stubFetch(() => respond(fetched.calls.length));
    double = fetched;
    const { root, handle } = mountApp(app);
    try {
      clickContaining(root, "Load");
      await tick(waitMs);
      expect(fetched.calls).toHaveLength(calls);
      const live = defined(app.live, "the app's live map") as Record<string, { _tag: string }>;
      expect(defined(live.state, "the state slot")._tag).toBe(state);
      handle.dispose();
    } finally {
      root.remove();
    }
  });
});
