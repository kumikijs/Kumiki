// Regression for issue #131: a reducer with `on=ui.click(Tile#id)` must fire
// only when the dispatched element's tile is `Tile` AND its `{id}` prop equals
// the selector's id. A reducer with no `#id` still matches every instance. The
// pre-fix behaviour wired all same-tile reducers regardless of id, so the
// "miss" reducer below would also fire — `log` would contain "hit;miss;plain;"
// instead of "hit;plain;". This test pins the post-fix behaviour.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "examples");
const selectorIdApp = join(examples, "features", "51-selector-id.kumiki");

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

describe("static TileName#id selector (#131)", () => {
  it("fires only the id-matching reducer plus the unscoped one, in source order", async () => {
    const app = await loadApp(selectorIdApp);
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

  it("skips id-scoped reducers whose id does not match the clicked tile's {id}", async () => {
    // Clicking EditBtn (id="edit") matches no reducer in the app — all three
    // are scoped to NewBtn — so log stays empty. This guards against the
    // tile-name-only check accidentally firing NewBtn's reducers on EditBtn.
    const app = await loadApp(selectorIdApp);
    const report = await runScenario(app, freshRoot(), {
      steps: [
        {
          do: { clickText: "Edit" },
          expect: { noErrors: true, state: { log: "" } },
        },
      ],
    });
    expect(report.ok).toBe(true);
  });

  it("renders the tile's {id} prop as a native DOM id attribute", async () => {
    // AC#1 of #131: `{id}` is exposed as the element's native HTML `id`. This
    // both drives selector matching (via `el.id`) and lets external code (CSS,
    // accessibility tooling, tests) find the element by id.
    const app = await loadApp(selectorIdApp);
    const root = freshRoot();
    await runScenario(app, root, { steps: [{ expect: { noErrors: true } }] });
    expect(root.querySelector("#new")?.tagName.toLowerCase()).toBe("button");
    expect(root.querySelector("#edit")?.tagName.toLowerCase()).toBe("button");
  });
});
