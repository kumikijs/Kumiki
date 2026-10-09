// A decoder written without parentheses reaches the runtime as a decoder, and
// each decoder delivers what it names.
//
// `Decoder.Text` / `Decoder.Bytes` / `Decoder.None` read as values in the spec
// (http.md §6.1.4) and are written bare there — the compiler reads the bare
// form as a call given no arguments, which for these members is that value. A
// request with no decoder is decoded as JSON, and the example's responses are
// ones JSON cannot decode, so a bare form lowered to nothing takes the `.err`
// branch. `kumiki smoke` on the example reports that too, since no effect
// declares an `.err` reducer; what this file adds is the slot values, which say
// what each decoder delivered rather than only whether something failed.
//
// The responses are the example's own `.http.json`, the fixture smoke answers
// it with.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHttpFixture, useHttpFixture } from "@kumikijs/cli";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "75-paren-less-stdlib-constants.kumiki");

const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("a stdlib constant written without parentheses", () => {
  afterEach(() => {
    useHttpFixture(null);
    document.body.replaceChildren();
  });

  it("decodes each response the way the effect asked for", async () => {
    useHttpFixture(readHttpFixture(EXAMPLE));
    const app = await loadApp(EXAMPLE);

    const root = document.createElement("div");
    document.body.appendChild(root);
    const handle = mount(app, root);
    try {
      // The empty-handle sentinel is a value, not a call.
      const live = defined(app.live, "the app's live map");
      expect(live.handle).toBe("");

      const load = [...root.querySelectorAll("button")].find((b) => b.textContent === "Load");
      expect(load, "the example renders a Load button").toBeDefined();
      load?.click();
      await settle();

      // `Decoder.Text`: the body arrives as the text it is.
      expect(live.note).toBe("kumiki");
      // `Decoder.None`: the 204 has nothing to decode.
      expect(live.pinged).toBe(true);
      // `Decoder.Bytes`: `日本語` arrives as its nine UTF-8 bytes, which `show`
      // renders one number each. The text would show its three characters.
      expect(live.raw).toBe("230,151,165,230,156,172,232,170,158");
      expect(root.textContent).toContain("raw: 230,151,165,230,156,172,232,170,158");
    } finally {
      handle.dispose();
    }
  });

  // `kumiki smoke` only reports an effect error that no reducer consumes, so
  // the example's silence on `.err` is what makes the smoke tier answer for
  // this at all — reverting the lowering there names every failing effect.
  // Adding the `.err` reducers a reader might supply "for completeness" would
  // take that tier away with nothing turning red, so the absence is asserted
  // rather than left to a comment.
  it("leaves the example's effect errors unconsumed, which is what smoke reports", () => {
    const source = readFileSync(EXAMPLE, "utf8");
    const consumed = [...source.matchAll(/on=(\w+)\.err\(/g)].map((m) => m[1]);
    expect(consumed).toEqual([]);
  });
});
