// Text tile renderers (#71): static content tiles (heading, text, label,
// link, markdown, code, icon).

import type { AppShape, TileRenderers } from "./core.ts";
import { applyTextProps } from "./core.ts";

export const textTiles: TileRenderers = {
  heading(node) {
    const h = document.createElement("h1");
    h.dataset.kumikiTile = "heading";
    h.textContent = node.text;
    applyTextProps(h, node.props);
    return h;
  },
  text(node) {
    const span = document.createElement("span");
    span.dataset.kumikiTile = "text";
    span.textContent = node.text;
    applyTextProps(span, node.props);
    return span;
  },
  label(node) {
    const lbl = document.createElement("label");
    lbl.dataset.kumikiTile = "label";
    lbl.textContent = node.text;
    const forAttr = node.props?.for;
    if (typeof forAttr === "string") lbl.htmlFor = forAttr;
    return lbl;
  },
  link(node) {
    const a = document.createElement("a");
    a.dataset.kumikiTile = "link";
    a.href = node.to;
    a.textContent = node.text;
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      const win = window as unknown as { __kumikiApp?: AppShape };
      const nav = (win.__kumikiApp as AppShape & { _navigate?: (p: string, r?: boolean) => void })
        ?._navigate;
      if (nav) nav(node.to, false);
    });
    // §3.8 prefetch — fire the named reducer once the link enters the viewport.
    // Dedupe by `to` URL (kept on the app instance) so that re-renders triggered
    // by the reducer itself don't re-observe and re-dispatch in a tight loop.
    if (node.prefetch) {
      const reducer = node.prefetch;
      const payload = node.prefetchArgs ?? {};
      const winRef = window as unknown as { __kumikiApp?: AppShape };
      const app = winRef.__kumikiApp as
        | (AppShape & {
            _dispatch?: (name: string, el: Record<string, unknown>) => void;
            _prefetched?: Set<string>;
          })
        | undefined;
      let seen: Set<string> | undefined;
      if (app) {
        if (!app._prefetched) app._prefetched = new Set<string>();
        seen = app._prefetched;
      }
      const dedupeKey = node.to;
      if (!seen?.has(dedupeKey)) {
        const fire = (): void => {
          if (seen?.has(dedupeKey)) return;
          seen?.add(dedupeKey);
          app?._dispatch?.(reducer, payload);
        };
        const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
          .IntersectionObserver;
        if (typeof IO === "function") {
          const observer = new IO((entries, obs) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                obs.disconnect();
                fire();
                return;
              }
            }
          });
          observer.observe(a);
        } else {
          // Fallback for DOMs without IntersectionObserver — dispatch once on
          // the next microtask so smoke tests still observe the call.
          queueMicrotask(fire);
        }
      }
    }
    return a;
  },
  markdown(node) {
    const div = document.createElement("div");
    div.dataset.kumikiTile = "markdown";
    // Minimal markdown: paragraphs split on blank lines, single line breaks preserved.
    const text = node.text ?? "";
    const paragraphs = text.split(/\n\s*\n/);
    for (const para of paragraphs) {
      const p = document.createElement("p");
      p.textContent = para.trim();
      p.style.whiteSpace = "pre-wrap";
      div.appendChild(p);
    }
    return div;
  },
  code(node) {
    const pre = document.createElement("pre");
    pre.dataset.kumikiTile = "code";
    const code = document.createElement("code");
    code.textContent = node.text;
    if (node.lang) code.dataset.lang = node.lang;
    pre.appendChild(code);
    return pre;
  },
  icon(node) {
    const span = document.createElement("span");
    span.dataset.kumikiTile = "icon";
    span.textContent = `[${node.name}]`;
    return span;
  },
};
