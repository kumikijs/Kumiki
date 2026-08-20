// A decoder written without parentheses has to reach the runtime as a decoder.
//
// `Decoder.Text` / `Decoder.Bytes` / `Decoder.None` are values in the spec
// (http.md §6.1.4) and are written bare there, but only the parenthesised form
// was ever lowered — the bare one became a field read on a variant named after
// the qualifier and emitted `undefined`. Nothing objected: `check` had no
// reason to, and the emitted module was valid JavaScript.
//
// It was not harmless. The HTTP handler reads `decode ?? "json"`, so `undefined`
// means **json** — a body meant to be discarded was parsed, and a 204 with no
// body threw inside `res.json()` and took the `.err` branch. `kumiki smoke` on
// the example reports that too, since neither effect declares an `.err`
// reducer; what this file adds is the slot values, which say which branch ran
// rather than only that something failed.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "75-paren-less-stdlib-constants.kumiki");

const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The two responses the example's requests expect, by path. */
function respond(url: string): Response {
  if (url.includes("/api/note")) return new Response("kumiki", { status: 200 });
  // No body at all, which is what `Decoder.None` exists for and what
  // `res.json()` cannot survive.
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
      // The empty-handle sentinel is a value, not a call, and is the one bare
      // constant that always parsed — it is here as the regression pin.
      expect(app.live.handle).toBe("");

      const load = [...root.querySelectorAll("button")].find((b) => b.textContent === "Load");
      expect(load, "the example renders a Load button").toBeDefined();
      load?.click();
      await settle();

      // `Decoder.Text`: the body arrives as the text it is. Read as json it
      // threw on `kumiki`, and the effect took its `.err` branch instead —
      // which this app does not declare, so the value simply never arrived.
      expect(app.live.note).toBe("kumiki");
      // `Decoder.None`: nothing to decode. Read as json, a 204 threw.
      expect(app.live.pinged).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  // `kumiki smoke` only reports an effect error that no reducer consumes, so
  // the example's silence on `.err` is what makes the smoke tier answer for
  // this at all — reverting the lowering there names both failing effects.
  // Adding the `.err` reducers a reader might supply "for completeness" would
  // take that tier away with nothing turning red, so the absence is asserted
  // rather than left to a comment.
  it("leaves the example's effect errors unconsumed, which is what smoke reports", () => {
    const source = readFileSync(EXAMPLE, "utf8");
    const consumed = [...source.matchAll(/on=(\w+)\.err\(/g)].map((m) => m[1]);
    expect(consumed).toEqual([]);
  });
});
