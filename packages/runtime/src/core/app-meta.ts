import type { AppShape } from "./types.ts";

export function applyAppMeta(app: AppShape): void {
  const meta = app.meta;
  if (!meta) return;
  if (typeof document === "undefined") return;
  if (meta.title !== undefined) document.title = meta.title;
  if (meta.description !== undefined) upsertMetaTag("name", "description", meta.description);
  if (meta.ogImage !== undefined) upsertMetaTag("property", "og:image", meta.ogImage);
  if (meta.favicon !== undefined) upsertFavicon(meta.favicon);
}

function upsertMetaTag(attr: "name" | "property", key: string, content: string): void {
  const head = document.head;
  if (!head) return;
  let el = head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertFavicon(href: string): void {
  const head = document.head;
  if (!head) return;
  let el = head.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "icon");
    head.appendChild(el);
  }
  el.setAttribute("href", href);
}
