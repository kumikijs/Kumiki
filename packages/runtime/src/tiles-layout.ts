// Layout tile renderers (#71): flow containers, grid, divider, and the
// route-outlet placeholder. Children recurse through `ctx.render`, so this
// module never needs to know which other tile families are loaded.

import { applyContainerProps, type TileCtx, type TileNode, type TileRenderers } from "./core.ts";

type Node<K extends TileNode["kind"]> = TileNode & { kind: K };

function appendChildren(el: HTMLElement, children: TileNode[], ctx: TileCtx): void {
  for (const child of children) {
    if (child != null) el.appendChild(ctx.render(child));
  }
}

function renderFlexColumn(node: Node<"page" | "column">, ctx: TileCtx): HTMLElement {
  const div = document.createElement("div");
  div.dataset.kumikiTile = node.kind;
  div.style.display = "flex";
  div.style.flexDirection = "column";
  applyContainerProps(div, node.props);
  appendChildren(div, node.children, ctx);
  return div;
}

function renderBox(
  node: Node<"card" | "box" | "panel" | "fieldset" | "stack" | "region" | "scroll">,
  ctx: TileCtx,
): HTMLElement {
  const div = document.createElement("div");
  div.dataset.kumikiTile = node.kind;
  if (node.kind === "card") {
    // Default padding only if the prop didn't override it.
    if (!node.props || node.props.pad === undefined) div.style.padding = "16px";
    div.style.marginBottom = "12px";
    div.style.borderRadius = "8px";
  }
  if (node.kind === "scroll") {
    div.style.overflow = "auto";
  }
  if (node.kind === "stack") {
    div.style.display = "flex";
    div.style.flexDirection = "column";
  }
  applyContainerProps(div, node.props);
  appendChildren(div, node.children, ctx);
  return div;
}

export const layoutTiles: TileRenderers = {
  page: renderFlexColumn,
  column: renderFlexColumn,
  row(node, ctx) {
    const div = document.createElement("div");
    div.dataset.kumikiTile = "row";
    div.style.display = "flex";
    div.style.flexDirection = "row";
    applyContainerProps(div, node.props);
    appendChildren(div, node.children, ctx);
    return div;
  },
  card: renderBox,
  box: renderBox,
  panel: renderBox,
  fieldset: renderBox,
  stack: renderBox,
  region: renderBox,
  scroll: renderBox,
  grid(node, ctx) {
    const div = document.createElement("div");
    div.dataset.kumikiTile = "grid";
    div.style.display = "grid";
    const cols = node.props?.cols;
    if (typeof cols === "number") div.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    else if (typeof cols === "string") div.style.gridTemplateColumns = cols;
    else div.style.gridTemplateColumns = "repeat(3, 1fr)";
    applyContainerProps(div, node.props);
    appendChildren(div, node.children, ctx);
    return div;
  },
  divider() {
    const hr = document.createElement("hr");
    hr.dataset.kumikiTile = "divider";
    return hr;
  },
  "route-outlet"(node, ctx) {
    // §3.6: `pickRootTile` injects the matched child tile into `node.children`
    // before render. Without a sub-route match, children stay empty and the
    // outlet renders as an empty placeholder.
    const div = document.createElement("div");
    div.dataset.kumikiTile = "route-outlet";
    appendChildren(div, node.children, ctx);
    return div;
  },
};
