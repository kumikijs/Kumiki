// Text tile renderers (#71): static content tiles (heading, text, label,
// link, markdown, code, icon).

import type { AppShape, TileProps, TileRenderers } from "./core.ts";
import { applyTextProps, currentTheme } from "./core.ts";

const ICON_SIZE_TOKENS: Record<string, string> = {
  sm: "16px",
  md: "24px",
  lg: "32px",
  xl: "48px",
};

/** Normalize an `icon` `size` prop to a CSS length. Default tracks font size. */
function resolveIconSize(raw: unknown): string {
  if (typeof raw === "number") return `${raw}px`;
  if (typeof raw === "string") {
    const token = ICON_SIZE_TOKENS[raw];
    if (token) return token;
    return raw;
  }
  return "1em";
}

/** Theme override (`theme.icons[name]`) wins over the compile-baked built-ins. */
function resolveIconPath(name: string): string | null {
  const themeIcons = currentTheme()?.icons;
  if (themeIcons && typeof themeIcons === "object") {
    const t = (themeIcons as Record<string, unknown>)[name];
    if (typeof t === "string" && t.length > 0) return t;
  }
  const app = (window as unknown as { __kumikiApp?: AppShape }).__kumikiApp;
  const builtin = app?.icons?.[name];
  if (typeof builtin === "string" && builtin.length > 0) return builtin;
  return null;
}

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
            _prefetch?: (name: string, args: Record<string, string>, to: string) => void;
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
          app?._prefetch?.(reducer, payload as Record<string, string>, node.to);
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
    span.dataset.kumikiIconName = node.name;
    // `color` is resolved by applyTextProps against theme.colors; the inner
    // SVG inherits via `fill="currentColor"`. `size` controls the SVG box only,
    // so it is pulled out before applying the remaining props as text styling.
    const props: TileProps = { ...(node.props ?? {}) };
    const sizeRaw = props.size;
    delete (props as Record<string, unknown>).size;
    applyTextProps(span, props);

    const d = resolveIconPath(node.name);
    if (!d) {
      // Unresolved name — preserve the historical placeholder so the failure is
      // visible without crashing the render (smoke-friendly).
      span.textContent = `[${node.name}]`;
      return span;
    }

    const size = resolveIconSize(sizeRaw);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    span.appendChild(svg);
    return span;
  },
};
