import {
  applyContainerProps,
  type EventHandler,
  type TileCtx,
  type TileNode,
  type TilePatchers,
  type TileProps,
  type TileRenderers,
} from "./core.ts";

function appendChildren(el: HTMLElement, children: TileNode[], ctx: TileCtx): void {
  for (const child of children) {
    if (child != null) el.appendChild(ctx.render(child));
  }
}

function coverParent(el: HTMLElement): void {
  el.style.top = "0";
  el.style.right = "0";
  el.style.bottom = "0";
  el.style.left = "0";
}

function applyOverlayAlign(layer: HTMLElement, align: string): void {
  const parts = align.split("-");
  const has = (k: string): boolean => parts.includes(k);
  layer.style.alignItems = has("top") ? "flex-start" : has("bottom") ? "flex-end" : "center";
  layer.style.justifyContent = has("left") ? "flex-start" : has("right") ? "flex-end" : "center";
}

type SurfaceHandlers = { onClose?: EventHandler; el?: Record<string, unknown> };
const SURFACE_STATE = new WeakMap<HTMLElement, SurfaceHandlers>();
function surfaceHandlers(node: { props?: TileProps }): SurfaceHandlers {
  const h: SurfaceHandlers = {};
  if (node.props?.onClose) h.onClose = node.props.onClose;
  if (node.props?.el !== undefined) h.el = node.props.el;
  return h;
}

export const overlayTiles: TileRenderers = {
  overlay(node, ctx) {
    const div = document.createElement("div");
    div.dataset.kumikiTile = "overlay";
    div.style.position = "relative";
    applyContainerProps(div, node.props);
    const align = typeof node.props?.align === "string" ? (node.props.align as string) : "center";
    const kids = node.children.filter((c): c is TileNode => c != null);
    kids.forEach((child, i) => {
      if (i === 0) {
        div.appendChild(ctx.render(child));
        return;
      }
      const layer = document.createElement("div");
      layer.dataset.kumikiTile = "overlay-layer";
      layer.style.position = "absolute";
      coverParent(layer);
      layer.style.display = "flex";
      applyOverlayAlign(layer, align);
      layer.appendChild(ctx.render(child));
      div.appendChild(layer);
    });
    return div;
  },
  modal: renderSurface,
  drawer: renderSurface,
  popover: renderSurface,
  tooltip(node, ctx) {
    const span = document.createElement("span");
    span.dataset.kumikiTile = "tooltip";
    if (node.text) span.title = node.text;
    if (node.placement) span.dataset.placement = node.placement;
    appendChildren(span, node.children, ctx);
    return span;
  },
  details(node, ctx) {
    const det = document.createElement("details");
    det.dataset.kumikiTile = "details";
    if (node.open) det.open = true;
    const idProp = node.props?.id;
    if (typeof idProp === "string") det.id = idProp;
    const summary = document.createElement("summary");
    summary.textContent = node.summary;
    det.appendChild(summary);
    appendChildren(det, node.children, ctx);
    return det;
  },
};

function renderSurface(
  node: TileNode & { kind: "modal" | "drawer" | "popover" },
  ctx: TileCtx,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.dataset.kumikiTile = node.kind;
  if (node.kind === "modal") wrap.setAttribute("role", "dialog");
  applySurfaceLabel(wrap, node.title);
  applySurfaceOpen(wrap, node.kind, node.open);
  if (node.kind === "modal") {
    wrap.style.position = "fixed";
    coverParent(wrap);
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "center";
    wrap.style.background = "rgba(0,0,0,0.4)";
  } else if (node.kind === "drawer") {
    wrap.style.position = "fixed";
    wrap.style.top = "0";
    wrap.style.bottom = "0";
    wrap.style[node.side === "right" ? "right" : "left"] = "0";
  }
  SURFACE_STATE.set(wrap, surfaceHandlers(node));
  wrap.addEventListener("click", (e) => {
    if (e.target !== wrap) return;
    const state = SURFACE_STATE.get(wrap);
    if (state?.onClose) state.onClose(state.el ?? {});
  });
  const inner = document.createElement("div");
  inner.dataset.kumikiTile = `${node.kind}-content`;
  inner.style.background = "#fff";
  if (node.title) {
    const h = document.createElement("h2");
    h.textContent = node.title;
    inner.appendChild(h);
  }
  appendChildren(inner, node.children, ctx);
  wrap.appendChild(inner);
  return wrap;
}

function applySurfaceLabel(wrap: HTMLElement, title: string | undefined): void {
  if (title) wrap.setAttribute("aria-label", title);
  else wrap.removeAttribute("aria-label");
}

/** Apply the open/closed `display` flip. Split out so both create and patch use one source of truth. */
function applySurfaceOpen(
  wrap: HTMLElement,
  kind: "modal" | "drawer" | "popover",
  open: boolean | undefined,
): void {
  if (kind === "modal") {
    wrap.style.display = open === false ? "none" : "flex";
  } else if (open === false) {
    wrap.style.display = "none";
  } else {
    wrap.style.display = "";
  }
}

function reconcileSurfaceTitle(inner: HTMLElement, title: string | undefined): void {
  const firstChild = inner.firstElementChild;
  const currentH = firstChild && firstChild.tagName === "H2" ? (firstChild as HTMLElement) : null;
  if (title != null) {
    if (currentH) {
      if (currentH.textContent !== title) currentH.textContent = title;
    } else {
      const h = document.createElement("h2");
      h.textContent = title;
      inner.insertBefore(h, inner.firstChild);
    }
  } else if (currentH) {
    inner.removeChild(currentH);
  }
}

function patchSurface(
  el: HTMLElement,
  oldNode: TileNode & { kind: "modal" | "drawer" | "popover" },
  newNode: TileNode & { kind: "modal" | "drawer" | "popover" },
): void {
  const wrap = el;
  if (oldNode.open !== newNode.open) applySurfaceOpen(wrap, newNode.kind, newNode.open);
  if (newNode.kind === "drawer" && oldNode.side !== newNode.side) {
    wrap.style.left = "";
    wrap.style.right = "";
    wrap.style[newNode.side === "right" ? "right" : "left"] = "0";
  }
  applySurfaceLabel(wrap, newNode.title);
  const inner = wrap.firstElementChild as HTMLElement | null;
  if (inner) reconcileSurfaceTitle(inner, newNode.title);
  SURFACE_STATE.set(wrap, surfaceHandlers(newNode));
}

export const overlayPatchers: TilePatchers = {
  overlay(el, _oldNode, newNode) {
    applyContainerProps(el, newNode.props);
  },
  modal: patchSurface,
  drawer: patchSurface,
  popover: patchSurface,
  tooltip(el, _oldNode, newNode) {
    const span = el as HTMLSpanElement;
    if (newNode.text != null) {
      if (span.title !== newNode.text) span.title = newNode.text;
    } else if (span.title) {
      span.removeAttribute("title");
    }
    if (newNode.placement != null) {
      if (span.dataset.placement !== newNode.placement) span.dataset.placement = newNode.placement;
    } else if (span.dataset.placement !== undefined) {
      delete span.dataset.placement;
    }
  },
  details(el, oldNode, newNode) {
    const det = el as HTMLDetailsElement;
    if (oldNode.open !== newNode.open) det.open = !!newNode.open;
    const idProp = newNode.props?.id;
    if (typeof idProp === "string") {
      if (det.id !== idProp) det.id = idProp;
    } else if (det.id) {
      det.removeAttribute("id");
    }
    const summary = det.firstElementChild;
    if (summary && summary.tagName === "SUMMARY" && summary.textContent !== newNode.summary) {
      summary.textContent = newNode.summary;
    }
  },
};
