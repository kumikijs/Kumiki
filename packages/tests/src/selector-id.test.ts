import { feature } from "@kumikijs/examples";
import { mount, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const blockStyleApp = feature("51-selector-id");
const argStyleApp = feature("52-selector-id-arg");

describe("static TileName#id selector matching", () => {
  it("fires id-scoped + unscoped reducers in source order, skips id-mismatched ones", async () => {
    const report = await runScenario(await loadApp(blockStyleApp), freshRoot(), {
      steps: [
        { do: { clickText: "New" }, expect: { noErrors: true, state: { log: "hit;plain;" } } },
      ],
    });
    expect(report.ok).toBe(true);
  });

  it("renders the {id} prop as the element's native DOM id attribute", async () => {
    const root = freshRoot();
    const handle = mount(await loadApp(blockStyleApp), root);
    try {
      expect(root.querySelector("#new")?.tagName.toLowerCase()).toBe("button");
      expect(root.querySelector("#edit")?.tagName.toLowerCase()).toBe("button");
    } finally {
      handle.dispose();
    }
  });

  it('matches arg-style id (input(id="…")) the same as block-style {id: "…"}', async () => {
    const report = await runScenario(await loadApp(argStyleApp), freshRoot(), {
      steps: [
        { do: { fill: "input", value: "hello" }, expect: { noErrors: true, state: { hits: 1 } } },
      ],
    });
    expect(report.ok).toBe(true);
  });
});
