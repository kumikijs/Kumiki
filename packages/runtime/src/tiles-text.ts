// Text tile renderers (#71): static content tiles (heading, text, label,
// link, markdown, code, icon).

import type { TilePatchers, TileProps, TileRenderers } from "./core.ts";
import {
  applyTextProps,
  currentTheme,
  getRenderingApp,
  resolveApp,
  warnUnresolvedEvent,
} from "./core.ts";

// Per-link state slot (#190): the click listener reads the current
// navigation target here rather than closing over the create-time value,
// so a link tile reused across a `to=` change still routes correctly.
const LINK_STATE = new WeakMap<HTMLElement, { to: string; external: boolean }>();

function isExternal(props?: TileProps): boolean {
  return props?.external === true;
}

/**
 * `external` on a link (stdlib.md §2.3.2). It opens in a new browsing context,
 * and `rel` goes with it: without `noopener` the page that opens gets a handle
 * on this one through `window.opener`.
 */
function applyExternal(a: HTMLAnchorElement, props?: TileProps): void {
  if (isExternal(props)) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  } else {
    a.removeAttribute("target");
    a.removeAttribute("rel");
  }
}

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

/**
 * Theme override (`theme.icons[name]`) wins over the compile-baked built-ins.
 * Render-time lookup: both sources come from the app whose render pass is
 * running (multi-mount registry in core).
 */
function resolveIconPath(name: string): string | null {
  const themeIcons = currentTheme()?.icons;
  if (themeIcons && typeof themeIcons === "object") {
    const t = (themeIcons as Record<string, unknown>)[name];
    if (typeof t === "string" && t.length > 0) return t;
  }
  const builtin = getRenderingApp()?.icons?.[name];
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
    // Per-element handler slot (#190): the click listener reads the *current*
    // navigation target from LINK_STATE rather than closing over the create-
    // time `node.to`. When the link tile is reused across a patch and its
    // `to=` changed (e.g. same <a> flipped from "/page" to "/"), the click
    // still routes to the correct target — otherwise the stale closure would
    // keep navigating to the original destination.
    LINK_STATE.set(a, { to: node.to, external: isExternal(node.props) });
    applyExternal(a, node.props);
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      // An external link leaves the app (§3.8): the router has no route for
      // where it goes, so it stays the browser's navigation.
      if (LINK_STATE.get(a)?.external) return;
      // Resolve BEFORE preventDefault: a link outside any live mount (stale
      // node, disposed app) degrades to the browser's native navigation via
      // `href` instead of becoming a dead link.
      const app = resolveApp(a);
      if (!app) {
        warnUnresolvedEvent(a, "link click; falling back to native navigation");
        return;
      }
      e.preventDefault();
      const state = LINK_STATE.get(a);
      app._navigate(state?.to ?? node.to, false);
    });
    // §3.8 prefetch — fire the named reducer once the link enters the viewport.
    // Dedupe by `to` URL (kept on the app instance) so that re-renders triggered
    // by the reducer itself don't re-observe and re-dispatch in a tight loop.
    if (node.prefetch) {
      const reducer = node.prefetch;
      const payload = node.prefetchArgs ?? {};
      const dedupeKey = node.to;
      // Render-time gate: skip re-observing when this app already prefetched
      // the target. The observer callback / microtask runs after the tree is
      // attached, so `fire` resolves the OWNING app from the anchor element.
      if (!getRenderingApp()?._prefetched?.has(dedupeKey)) {
        const fire = (): void => {
          const app = resolveApp(a);
          if (!app) {
            warnUnresolvedEvent(a, "link prefetch");
            return;
          }
          if (!app._prefetched) app._prefetched = new Set<string>();
          if (app._prefetched.has(dedupeKey)) return;
          app._prefetched.add(dedupeKey);
          app._prefetch(reducer, payload as Record<string, string>, node.to);
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

// Static-content patchers. These tiles have no browser-internal state to
// preserve (heading, text, label, code) or wire their listeners through
// `resolveApp` on demand (link) — the win from patching is just avoiding a
// full subtree rebuild every render, so children and event listeners on
// still-mounted ancestors are kept intact. `link` prefetch runs at create
// time (IntersectionObserver on the anchor); a patch never re-arms it,
// matching pre-#190 semantics where prefetch fired once per mount.
export const textPatchers: TilePatchers = {
  heading(el, _oldNode, newNode) {
    const h = el as HTMLHeadingElement;
    if (h.textContent !== newNode.text) h.textContent = newNode.text;
    applyTextProps(h, newNode.props);
  },
  text(el, _oldNode, newNode) {
    const span = el as HTMLSpanElement;
    if (span.textContent !== newNode.text) span.textContent = newNode.text;
    applyTextProps(span, newNode.props);
  },
  label(el, _oldNode, newNode) {
    const lbl = el as HTMLLabelElement;
    if (lbl.textContent !== newNode.text) lbl.textContent = newNode.text;
    const forAttr = newNode.props?.for;
    if (typeof forAttr === "string") {
      if (lbl.htmlFor !== forAttr) lbl.htmlFor = forAttr;
    } else if (lbl.htmlFor) {
      lbl.removeAttribute("for");
    }
  },
  link(el, _oldNode, newNode) {
    const a = el as HTMLAnchorElement;
    if (a.getAttribute("href") !== newNode.to) a.href = newNode.to;
    if (a.textContent !== newNode.text) a.textContent = newNode.text;
    // Route the click listener at the CURRENT `to` — see LINK_STATE note.
    LINK_STATE.set(a, { to: newNode.to, external: isExternal(newNode.props) });
    applyExternal(a, newNode.props);
    // Do NOT re-arm prefetch. Prefetch is a fire-once side effect (§3.8),
    // and re-observing on every patch would defeat the dedupe by target URL.
  },
  markdown(el, _oldNode, newNode) {
    const div = el as HTMLDivElement;
    // Markdown renders paragraph-per-blank-line; on any text change reflow
    // the paragraph list. This is a mount-only content tile so keeping the
    // outer wrapper preserves any scroll position of an enclosing container.
    const text = newNode.text ?? "";
    const paragraphs = text.split(/\n\s*\n/);
    const existing = div.querySelectorAll("p");
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i]?.trim() ?? "";
      const cur = existing[i];
      if (cur) {
        if (cur.textContent !== para) cur.textContent = para;
      } else {
        const p = document.createElement("p");
        p.textContent = para;
        p.style.whiteSpace = "pre-wrap";
        div.appendChild(p);
      }
    }
    // Drop trailing extras when the paragraph count shrunk.
    for (let i = existing.length - 1; i >= paragraphs.length; i--) {
      const p = existing[i];
      if (p) div.removeChild(p);
    }
  },
  code(el, oldNode, newNode) {
    const pre = el as HTMLPreElement;
    const code = pre.querySelector("code");
    if (code && code.textContent !== newNode.text) code.textContent = newNode.text;
    if (code) {
      if (newNode.lang != null) {
        if (code.dataset.lang !== newNode.lang) code.dataset.lang = newNode.lang;
      } else if (oldNode.lang != null) {
        delete code.dataset.lang;
      }
    }
  },
  icon(el, oldNode, newNode) {
    // Icons: if the name changes the SVG path itself must be swapped, but the
    // wrapper span is preserved so a size/color prop change alone doesn't
    // rebuild the SVG. This preserves whatever ambient styles the parent
    // painted onto the span.
    const span = el as HTMLSpanElement;
    const props: TileProps = { ...(newNode.props ?? {}) };
    const sizeRaw = props.size;
    delete (props as Record<string, unknown>).size;
    applyTextProps(span, props);
    if (oldNode.name !== newNode.name) {
      span.dataset.kumikiIconName = newNode.name;
      const d = resolveIconPath(newNode.name);
      const existing = span.querySelector("svg");
      if (existing) span.removeChild(existing);
      const priorPlaceholder = span.childNodes.length === 0 ? null : span.firstChild;
      if (!d) {
        span.textContent = `[${newNode.name}]`;
        return;
      }
      // Clear any placeholder text-node left from a prior "unresolved" render.
      if (priorPlaceholder && priorPlaceholder.nodeType === 3) span.removeChild(priorPlaceholder);
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
      return;
    }
    // Same name — only size may have changed.
    const svg = span.querySelector("svg");
    if (svg) {
      const size = resolveIconSize(sizeRaw);
      if (svg.getAttribute("width") !== size) svg.setAttribute("width", size);
      if (svg.getAttribute("height") !== size) svg.setAttribute("height", size);
    }
  },
};
