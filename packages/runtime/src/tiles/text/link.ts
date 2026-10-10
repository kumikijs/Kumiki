import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import { getRenderingApp, resolveApp, warnUnresolvedEvent } from "../../core.ts";

const LINK_STATE = new WeakMap<HTMLElement, { to: string; external: boolean }>();

function isExternal(props?: TileProps): boolean {
  return props?.external === true;
}

/** What a link's click does with its target. */
type LinkDisposition =
  /** This app's router can serve it: intercept the click and navigate. */
  | "route"
  /** Off-origin but an ordinary navigation: leave the click to the browser. */
  | "browser"
  /** Neither — a scheme this runtime does not hand out. Cancel and say so. */
  | "unsafe";

const BROWSER_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "sms:"]);

const warnedLink = new WeakMap<Element, string>();

function linkDisposition(to: string): LinkDisposition {
  const here = typeof location !== "undefined" ? location.href : "";
  if (!here) return "route";
  let base: URL;
  let target: URL;
  try {
    base = new URL(here);
    target = new URL(to, base);
  } catch {
    return "route";
  }
  if (target.origin !== "null" && target.origin === base.origin) return "route";
  return BROWSER_SCHEMES.has(target.protocol) ? "browser" : "unsafe";
}

function warnLink(a: HTMLAnchorElement, to: string, disposition: LinkDisposition): void {
  if (warnedLink.get(a) === to) return;
  warnedLink.set(a, to);
  const what =
    disposition === "browser"
      ? "is off-origin; the router cannot serve it, so the browser navigates it " +
        "(add `{external: true}`)"
      : "uses a scheme this runtime does not navigate to; the click was ignored";
  console.warn(
    `kumiki: link ${JSON.stringify(a.textContent ?? "")} -> ${JSON.stringify(to)} ${what}`,
  );
}

function applyExternal(a: HTMLAnchorElement, props?: TileProps): void {
  if (isExternal(props)) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  } else {
    a.removeAttribute("target");
    a.removeAttribute("rel");
  }
}

export const linkTile: TileRenderer<"link"> = (node) => {
  const a = document.createElement("a");
  a.dataset.kumikiTile = "link";
  a.href = node.to;
  a.textContent = node.text;
  LINK_STATE.set(a, { to: node.to, external: isExternal(node.props) });
  applyExternal(a, node.props);
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const state = LINK_STATE.get(a);
    const to = state?.to ?? node.to;
    const disposition = linkDisposition(to);
    if (disposition === "unsafe") {
      e.preventDefault();
      warnLink(a, to, disposition);
      return;
    }
    // The router has no route for an external link or another origin, so the browser keeps the click.
    if (state?.external) return;
    if (disposition === "browser") {
      warnLink(a, to, disposition);
      return;
    }
    const app = resolveApp(a);
    if (!app) {
      warnUnresolvedEvent(a, "link click; falling back to native navigation");
      return;
    }
    e.preventDefault();
    app._navigate(to, false);
  });
  if (node.prefetch) {
    const reducer = node.prefetch;
    const payload = node.prefetchArgs ?? {};
    const dedupeKey = node.to;
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
        queueMicrotask(fire);
      }
    }
  }
  return a;
};

export const linkPatcher: TilePatcher<"link"> = (el, _oldNode, newNode) => {
  const a = el as HTMLAnchorElement;
  if (a.getAttribute("href") !== newNode.to) a.href = newNode.to;
  if (a.textContent !== newNode.text) a.textContent = newNode.text;
  LINK_STATE.set(a, { to: newNode.to, external: isExternal(newNode.props) });
  applyExternal(a, newNode.props);
};
