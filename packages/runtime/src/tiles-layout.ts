import {
  applyContainerProps,
  gridTracks,
  pickForViewport,
  type TileCtx,
  type TileNode,
  type TilePatchers,
  type TileProps,
  type TileRenderers,
} from "./core.ts";

type Node<K extends TileNode["kind"]> = TileNode & { kind: K };

function appendChildren(el: HTMLElement, children: TileNode[], ctx: TileCtx): void {
  for (const child of children) {
    if (child != null) el.appendChild(ctx.render(child));
  }
}

function applyGridTracks(div: HTMLElement, props?: TileProps): void {
  const t = gridTracks(props, pickForViewport);
  div.style.gridTemplateColumns = t.cols;
  if (t.rows) div.style.gridTemplateRows = t.rows;
  else div.style.removeProperty("grid-template-rows");
}

function applyDividerOrientation(hr: HTMLElement, props?: TileProps): void {
  if (props?.orientation !== "vertical") {
    hr.removeAttribute("aria-orientation");
    for (const p of ["align-self", "width", "height", "border-left", "border-top"]) {
      hr.style.removeProperty(p);
    }
    return;
  }
  hr.setAttribute("aria-orientation", "vertical");
  hr.style.alignSelf = "stretch";
  hr.style.width = "0";
  hr.style.height = "auto";
  hr.style.borderTop = "none";
  hr.style.borderLeft = "1px solid currentColor";
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
  node: Node<"card" | "box" | "panel" | "stack" | "region" | "scroll">,
  ctx: TileCtx,
): HTMLElement {
  const div = document.createElement("div");
  div.dataset.kumikiTile = node.kind;
  if (node.kind === "card") {
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
  stack: renderBox,
  region: renderBox,
  scroll: renderBox,
  grid(node, ctx) {
    const div = document.createElement("div");
    div.dataset.kumikiTile = "grid";
    div.style.display = "grid";
    applyGridTracks(div, node.props);
    applyContainerProps(div, node.props);
    appendChildren(div, node.children, ctx);
    return div;
  },
  divider(node) {
    const hr = document.createElement("hr");
    hr.dataset.kumikiTile = "divider";
    applyDividerOrientation(hr, node.props);
    return hr;
  },
  "route-outlet"(node, ctx) {
    const div = document.createElement("div");
    div.dataset.kumikiTile = "route-outlet";
    appendChildren(div, node.children, ctx);
    return div;
  },
};

function patchContainer(el: HTMLElement, _oldNode: TileNode, newNode: TileNode): void {
  applyContainerProps(el, (newNode as { props?: import("./core.ts").TileProps }).props);
}

export const layoutPatchers: TilePatchers = {
  page: patchContainer,
  column: patchContainer,
  row: patchContainer,
  card: patchContainer,
  box: patchContainer,
  panel: patchContainer,
  stack: patchContainer,
  region: patchContainer,
  scroll: patchContainer,
  grid(el, _oldNode, newNode) {
    const div = el as HTMLDivElement;
    applyGridTracks(div, newNode.props);
    applyContainerProps(div, newNode.props);
  },
  divider(el, _oldNode, newNode) {
    applyDividerOrientation(el as HTMLElement, newNode.props);
  },
  "route-outlet"() {},
};
