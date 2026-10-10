import { feature } from "@kumikijs/examples";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { click, freshRoot, tick } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

describe("a stdlib constant written without parentheses", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
    document.body.replaceChildren();
  });

  it("decodes each response the way the effect asked for", async () => {
    const app = await loadApp(feature("75-paren-less-stdlib-constants"));
    double = stubFetch(({ url }) =>
      url.includes("/api/note")
        ? new Response("kumiki", { status: 200 })
        : // No body at all, which is what `Decoder.None` exists for and what `res.json()` cannot survive.
          new Response(null, { status: 204 }),
    );

    const root = freshRoot();
    const handle = mount(app, root);
    try {
      // The empty-handle sentinel is a value, not a call, and is the one bare constant that always parsed.
      const live = defined(app.live, "the app's live map");
      expect(live.handle).toBe("");

      click(root, "Load");
      await tick(30);

      expect(live.note).toBe("kumiki");
      expect(live.pinged).toBe(true);
    } finally {
      handle.dispose();
    }
  });
});
