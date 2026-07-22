// Media tile renderers (#71): image and video.

import type { TilePatchers, TileRenderers } from "./core.ts";

/** Read `{id: "..."}` from a tile's props (§1.6.2), when the tile kind doesn't lift `id` to a top-level field. */
function propId(node: { props?: Record<string, unknown> }): string | undefined {
  const raw = node.props?.id;
  return raw == null ? undefined : String(raw);
}

export const mediaTiles: TileRenderers = {
  image(node) {
    const img = document.createElement("img");
    img.dataset.kumikiTile = "image";
    img.src = node.src;
    const alt = node.props?.alt;
    if (typeof alt === "string") img.alt = alt;
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
