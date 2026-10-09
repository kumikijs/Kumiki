import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defined } from "./helpers/defined.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "75-paren-less-stdlib-constants.kumiki");

const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The two responses the example's requests expect, by path. */
function respond(url: string): Response {
  if (url.includes("/api/note")) return new Response("kumiki", { status: 200 });
  // No body at all, which is what `Decoder.None` exists for and what `res.json()` cannot survive.
  return new Response(null, { status: 204 });
}

describe("a stdlib constant written without parentheses", () => {
  let original: typeof fetch | undefined;

  afterEach(() => {
    if (original) globalThis.fetch = original;
    document.body.replaceChildren();
  });

  it("decodes each response the way the effect asked for", async () => {
    const app = await loadApp(EXAMPLE);
    original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: unknown) =>
      respond(typeof url === "string" ? url : (url as Request).url),
    ) as unknown as typeof fetch;

    const root = document.createElement("div");
    document.body.appendChild(root);
    const handle = mount(app, root);
    try {
      // The empty-handle sentinel is a value, not a call, and is the one bare constant that always parsed — it is here as the regression pin.
      const live = defined(app.live, "the app's live map");
      expect(live.handle).toBe("");

      const load = [...root.querySelectorAll("button")].find((b) => b.textContent === "Load");
      expect(load, "the example renders a Load button").toBeDefined();
      load?.click();
      await settle();

      expect(live.note).toBe("kumiki");
      expect(live.pinged).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("leaves the example's effect errors unconsumed, which is what smoke reports", () => {
    const source = readFileSync(EXAMPLE, "utf8");
    const consumed = [...source.matchAll(/on=(\w+)\.err\(/g)].map((m) => m[1]);
    expect(consumed).toEqual([]);
  });
});
