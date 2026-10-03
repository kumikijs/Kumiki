// Regression for spec §1.6.2: a reducer with `on=ui.click(Tile#id)` must fire
// only when the dispatched element's tile is `Tile` AND its `{id}` prop equals
// the selector's id. A reducer with no `#id` still matches every instance.
// Without this guard, an id-scoped reducer co-fires with the bare-tile one on
// every same-tile click, indistinguishable from `on=ui.click(Tile)`.

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
    // The example wires three reducers onto NewBtn's onClick handler:
    //   scopedHit  on=ui.click(NewBtn#new)   ← fires (id matches)
    //   scopedMiss on=ui.click(NewBtn#edit)  ← skipped at dispatch (id mismatch)
    //   plain      on=ui.click(NewBtn)       ← fires (unscoped)
    // Codegen chains all three; runtime _dispatch filters scopedMiss because
    // el.id ("new") does not equal the selector's id ("edit"). A regression
    // here would surface as log === "hit;miss;plain;".
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
    // Spec §1.6.2: `{id}` becomes the element's native `id` so CSS, a11y
    // tooling, and tests can find the element. This also drives selector
    // matching at dispatch time via the `el.id` payload.
    // Mounted directly rather than through `runScenario`: this asserts on
    // elements, and the runner disposes its mount on the way out, which empties
    // the root it rendered into.
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
    // Arg-style id (`input(id="new")`) lives in the tile node's top-level
    // field, not in the props bag. Without codegen lifting it into `el`, the
    // dispatch payload would have `el.id === undefined` and an id-scoped
    // reducer would silently never fire even though the rendered DOM input
    // carries `id="new"`. This pins symmetry between the two authoring forms.
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
