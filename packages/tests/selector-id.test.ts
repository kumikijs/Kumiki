import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "examples");
const blockStyleApp = join(examples, "features", "51-selector-id.kumiki");
const argStyleApp = join(examples, "features", "52-selector-id-arg.kumiki");

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

describe("static TileName#id selector matching", () => {
  it("fires id-scoped + unscoped reducers in source order, skips id-mismatched ones", async () => {
    const app = await loadApp(blockStyleApp);
    const report = await runScenario(app, freshRoot(), {
      steps: [
        {
          do: { clickText: "New" },
          expect: { noErrors: true, state: { log: "hit;plain;" } },
        },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.steps[0]?.state.log).toBe("hit;plain;");
  });

  it("renders the {id} prop as the element's native DOM id attribute", async () => {
    const app = await loadApp(blockStyleApp);
    const root = freshRoot();
    const handle = mount(app, root);
    try {
      expect(root.querySelector("#new")?.tagName.toLowerCase()).toBe("button");
      expect(root.querySelector("#edit")?.tagName.toLowerCase()).toBe("button");
    } finally {
      handle.dispose();
    }
  });

  it('matches arg-style id (input(id="…")) the same as block-style {id: "…"}', async () => {
    const app = await loadApp(argStyleApp);
    const report = await runScenario(app, freshRoot(), {
      steps: [
        {
          do: { fill: "input", value: "hello" },
          expect: { noErrors: true, state: { hits: 1 } },
        },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.steps[0]?.state.hits).toBe(1);
  });
});
