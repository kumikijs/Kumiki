import type { TileCtx, TileNode } from "@kumikijs/runtime";
import { inputPatchers, inputTiles, renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { appOf } from "./helpers/app.ts";
import { defined } from "./helpers/defined.ts";

type Button = Extract<TileNode, { kind: "button" }>;

const btn = (over: Partial<Button> = {}): Button => ({ kind: "button", text: "go", ...over });

// None of these tiles has children, so reaching `render` means a tile started recursing.
const ctx: TileCtx = {
  render: () => {
    throw new Error("this tile has no children to render");
  },
};

function render(node: Button): HTMLButtonElement {
  const el = defined(inputTiles.button, "the button renderer")(node, ctx);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`expected a <button>, got ${el.tagName}`);
  return el;
}

describe("button(type=…) reaches the DOM", () => {
  it.each(["button", "submit"])("writes type=%s", (type) => {
    expect(render(btn({ type })).type).toBe(type);
  });

  it("leaves the HTML default alone when the node says nothing", () => {
    expect(render(btn()).hasAttribute("type")).toBe(false);
    expect(render(btn()).type).toBe("submit");
  });

  it("reconciles the type when a conditional swaps one button for another", () => {
    const patch = defined(inputPatchers.button, "the button patcher");
    const el = render(btn({ type: "button" }));
    patch(el, btn({ type: "button" }), btn({ type: "submit" }), ctx);
    expect(el.getAttribute("type")).toBe("submit");
    patch(el, btn({ type: "submit" }), btn(), ctx);
    expect(el.hasAttribute("type")).toBe(false);
    patch(el, btn(), btn({ type: "reset" }), ctx);
    expect(el.getAttribute("type")).toBe("reset");
    // An empty string is "did not say", as on the create path.
    patch(el, btn({ type: "reset" }), btn({ type: "" }), ctx);
    expect(el.hasAttribute("type")).toBe(false);
  });

  it("serves the same type it hydrates to", async () => {
    const app = appOf(() => ({
      kind: "column",
      children: [btn({ type: "submit", text: "send" }), btn({ text: "plain" })],
    }));
    const { html } = await renderToString(app, {});
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('type="button"');
    const tags = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(tags).toHaveLength(2);
    expect(tags.filter((t) => t.includes("type="))).toHaveLength(1);
  });
});
