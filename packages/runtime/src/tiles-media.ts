import { attrValue, type TilePatchers, type TileRenderers } from "./core.ts";

function propId(node: { props?: Record<string, unknown> }): string | undefined {
  const raw = node.props?.id;
  return raw == null ? undefined : String(raw);
}

function applyImageBox(img: HTMLImageElement, props?: Record<string, unknown>): void {
  for (const name of ["width", "height"] as const) {
    const v = attrValue(props?.[name]);
    if (v !== undefined) img.setAttribute(name, String(v));
    else img.removeAttribute(name);
  }
  const loading = props?.loading;
  if (loading === "lazy" || loading === "eager") img.setAttribute("loading", loading);
  else img.removeAttribute("loading");
}

export const mediaTiles: TileRenderers = {
  image(node) {
    const img = document.createElement("img");
    img.dataset.kumikiTile = "image";
    img.src = node.src;
    const alt = node.props?.alt;
    if (typeof alt === "string") img.alt = alt;
    applyImageBox(img, node.props);
    const id = propId(node);
    if (id) img.id = id;
    return img;
  },
  video(node) {
    const v = document.createElement("video");
    v.dataset.kumikiTile = "video";
    if (node.src) v.src = node.src;
    if (node.controls) v.controls = true;
    if (node.autoplay) v.autoplay = true;
    const id = propId(node);
    if (id) v.id = id;
    return v;
  },
};

export const mediaPatchers: TilePatchers = {
  image(el, _oldNode, newNode) {
    const img = el as HTMLImageElement;
    const id = propId(newNode);
    if (id) {
      if (img.id !== id) img.id = id;
    } else if (img.id) {
      img.removeAttribute("id");
    }
    if (img.getAttribute("src") !== newNode.src) img.src = newNode.src;
    applyImageBox(img, newNode.props);
    const alt = newNode.props?.alt;
    if (typeof alt === "string") {
      if (img.alt !== alt) img.alt = alt;
    } else if (img.alt) {
      img.removeAttribute("alt");
    }
  },
  video(el, oldNode, newNode) {
    const v = el as HTMLVideoElement;
    const id = propId(newNode);
    if (id) {
      if (v.id !== id) v.id = id;
    } else if (v.id) {
      v.removeAttribute("id");
    }
    if ((oldNode.src ?? "") !== (newNode.src ?? "")) {
      if (newNode.src) {
        v.src = newNode.src;
        v.load();
      } else {
        v.removeAttribute("src");
      }
    }
    const nextControls = !!newNode.controls;
    if (v.controls !== nextControls) v.controls = nextControls;
    const nextAutoplay = !!newNode.autoplay;
    if (v.autoplay !== nextAutoplay) v.autoplay = nextAutoplay;
  },
};
