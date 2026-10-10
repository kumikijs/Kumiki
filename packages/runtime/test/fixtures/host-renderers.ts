import type { TileCtx, TileNode } from "@kumikijs/runtime";

export function firstChildMappedColumn(node: TileNode, ctx: TileCtx): HTMLElement {
  const el = document.createElement("div");
  const children = (node as { children?: TileNode[] }).children ?? [];
  children.forEach((child, i) => {
    if (i === 0) {
      el.appendChild(ctx.render(child));
      return;
    }
    const span = document.createElement("span");
    span.textContent = (child as { text?: string }).text ?? "";
    el.appendChild(span);
  });
  return el;
}
