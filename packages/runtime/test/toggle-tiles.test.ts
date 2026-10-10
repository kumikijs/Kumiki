import type { TileCtx, TileNode } from "@kumikijs/runtime";
import { inputPatchers, inputTiles } from "@kumikijs/runtime";
import { describe, expect, it, vi } from "vitest";
import { defined } from "./helpers/defined.ts";

type Toggle = Extract<TileNode, { kind: "check" | "switch" }>;

const ctx: TileCtx = {
  render: () => {
    throw new Error("a toggle has no children to render");
  },
};

function render(node: Toggle): HTMLElement {
  return defined(inputTiles[node.kind], `the ${node.kind} renderer`)(node as never, ctx);
}

function patch(el: HTMLElement, from: Toggle, to: Toggle): void {
  defined(inputPatchers[to.kind], `the ${to.kind} patcher`)(el, from as never, to as never, ctx);
}

const box = (el: HTMLElement): HTMLInputElement =>
  defined(el.querySelector("input"), "the checkbox");

describe.each([
  ["check", null],
  ["switch", "switch"],
] as const)("the %s tile", (kind, role) => {
  it("wraps a checkbox in a label tagged with its kind", () => {
    const el = render({ kind, checked: true, props: { id: "t" } });
    expect(el.tagName).toBe("LABEL");
    expect(el.dataset.kumikiTile).toBe(kind);
    expect(el.getAttribute("role")).toBe(role);
    expect(el.id).toBe("t");
    expect(box(el).type).toBe("checkbox");
    expect(box(el).checked).toBe(true);
  });

  it("reports a click and the new state when toggled", () => {
    const onClick = vi.fn();
    const onChange = vi.fn();
    const el = render({ kind, checked: false, props: { onClick, onChange, el: { id: "x" } } });
    box(el).checked = true;
    box(el).dispatchEvent(new Event("change"));
    expect(onClick).toHaveBeenCalledWith({ id: "x" });
    expect(onChange).toHaveBeenCalledWith({ id: "x", checked: true });
  });

  it("patches checked, bind marker, id and disabled in place", () => {
    const before: Toggle = { kind, checked: false, bind: "on", props: { id: "a" } };
    const el = render(before);
    const inp = box(el);
    expect(inp.dataset.kumikiBind).toBe("on");
    patch(el, before, { kind, checked: true, props: { disabled: true } });
    expect(box(el)).toBe(inp);
    expect(inp.checked).toBe(true);
    expect(inp.dataset.kumikiBind).toBeUndefined();
    expect(el.hasAttribute("id")).toBe(false);
    expect(inp.disabled).toBe(true);
  });
});
