// Media tile renderers (#71): image and video.

import type { TilePatchers, TileRenderers } from "./core.ts";

/** Read `{id: "..."}` from a tile's props (§1.6.2), when the tile kind doesn't lift `id` to a top-level field. */
function propId(node: { props?: Record<string, unknown> }): string | undefined {
  const raw = node.props?.id;
  return raw == null ? undefined : String(raw);
}

/**
 * `width` / `height` / `loading` on an `<img>` (stdlib.md §2.3.5). The first
 * two are what reserve the box before the bytes arrive — an image without them
 * moves everything below it when it loads, which is the layout shift the SSR
 * path exists to avoid. Shared by create and patch.
 */
function applyImageBox(img: HTMLImageElement, props?: Record<string, unknown>): void {
  for (const name of ["width", "height"] as const) {
    const v = props?.[name];
    if (typeof v === "number" || typeof v === "string") img.setAttribute(name, String(v));
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
    // Guard the `.src` write against no-op reassignment. Setting `src` to
    // the same string still triggers a re-request in some browsers (and
    // clears the cache-warmed decoded-image bitmap), so a bind-driven
    // rerender that leaves `src` untouched should not thrash the image.
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
    // #190 acceptance: `<video>` must survive a re-render triggered mid-
    // playback. Everything that touches playback state (`.load()`,
    // reassigning `.src` even to the same URL) is gated on the value
    // actually having changed.
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
