// Runtime-side halves of the divergences between `docs/spec/` and what the
// toolchain actually did. The compiler halves live in
// `packages/compiler/test/spec-divergences.test.ts`.

import type { AppShape, TileNode } from "@kumikijs/runtime";
import { inputPatchers, inputTiles, renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const btn = (over: Partial<Extract<TileNode, { kind: "button" }>> = {}) =>
  ({ kind: "button", text: "go", ...over }) as Extract<TileNode, { kind: "button" }>;

function render(node: Extract<TileNode, { kind: "button" }>): HTMLButtonElement {
  return inputTiles.button?.(node, () => null) as HTMLButtonElement;
}

// forms.md §5.2.2: `button(type="submit")` submits the form it is in. The
// renderer never read the field, so the attribute was never written and the
// browser's default decided for every button.
describe("button(type=…) reaches the DOM", () => {
  it("writes the type the node carries", () => {
    expect(render(btn({ type: "button" })).type).toBe("button");
    expect(render(btn({ type: "submit" })).type).toBe("submit");
  });

  it("leaves the HTML default alone when the node says nothing", () => {
    // `submit` is what a `<button>` with no type does inside a form. The tile
    // that did not ask for a type gets that, not a type this renderer chose.
    expect(render(btn()).hasAttribute("type")).toBe(false);
    expect(render(btn()).type).toBe("submit");
  });

  it("reconciles the type when a conditional swaps one button for another", () => {
    const el = render(btn({ type: "button" }));
    inputPatchers.button?.(el, btn({ type: "button" }), btn({ type: "submit" }));
    expect(el.type).toBe("submit");
    // …and back: the node that stops saying returns to the default rather than
    // keeping whatever the previous render happened to set.
    inputPatchers.button?.(el, btn({ type: "submit" }), btn());
    expect(el.type).toBe("submit");
    inputPatchers.button?.(el, btn(), btn({ type: "reset" }));
    expect(el.type).toBe("reset");
  });

  it("serves the same type it hydrates to", async () => {
    // The SSR renderer wrote `type="button"` on every button, so the served
    // HTML refused to submit and the hydrated page accepted — the one
    // divergence a user sees as "it works on the second click".
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: [btn({ type: "submit", text: "send" }), btn({ text: "plain" })],
      }),
    };
    const { html } = await renderToString(app, {});
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('type="button"');
  });
});
