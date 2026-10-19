import { readHttpFixture, useHttpFixture } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { click, freshRoot, tick } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("75-paren-less-stdlib-constants");

describe("a stdlib constant written without parentheses", () => {
  afterEach(() => {
    useHttpFixture(null);
    document.body.replaceChildren();
  });

  it("decodes each response the way the effect asked for", async () => {
    // The example's own `.http.json`, the fixture smoke answers it with.
    useHttpFixture(readHttpFixture(EXAMPLE));
    const app = await loadApp(EXAMPLE);

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
      // `日本語` arrives as its nine UTF-8 bytes, which `show` renders one number each; the text
      // would show its three characters.
      expect(live.raw).toBe("230,151,165,230,156,172,232,170,158");
      expect(root.textContent).toContain("raw: 230,151,165,230,156,172,232,170,158");
    } finally {
      handle.dispose();
    }
  });
});
