// The `link` tile (#71): its own shipping unit, so an app that renders one
// does not download the six other text tiles.

import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import { getRenderingApp, resolveApp, warnUnresolvedEvent } from "../../core.ts";

// Per-link state slot (#190): the click listener reads the current
// navigation target here rather than closing over the create-time value,
// so a link tile reused across a `to=` change still routes correctly.
const LINK_STATE = new WeakMap<HTMLElement, { to: string; external: boolean }>();

function isExternal(props?: TileProps): boolean {
  return props?.external === true;
}

/** What a link's click does with its target (#298). */
type LinkDisposition =
  /** This app's router can serve it: intercept the click and navigate. */
  | "route"
  /** Off-origin but an ordinary navigation: leave the click to the browser. */
  | "browser"
  /** Neither — a scheme this runtime does not hand out. Cancel and say so. */
  | "unsafe";

/**
 * The schemes a click may be handed back to the browser for. An allowlist
 * rather than a `javascript:` blocklist: `to` is an arbitrary expression
 * (codegen lowers it like any other), so a slot filled from an HTTP response
 * can reach it, and "not routable" must never mean "hand the document a
 * script URL to execute". Cancelling an unknown scheme costs a dead link that
 * did not work before this either — it went to `pushState` and threw.
 */
const BROWSER_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "sms:"]);

// Once-per-target diagnostic for a link the router does not serve (#298). The
// link still works when the browser takes it — but an author who meant to route
// somewhere is better told than left wondering. Keyed by the target rather than
// the element alone: the message names one `to`, and a link tile reused across
// a `to=` change (#190) is a different claim about a different URL.
const warnedLink = new WeakMap<Element, string>();

/**
 * What to do with `to`. Only a same-origin target can reach
 * `history.pushState`, which refuses anything else with a `SecurityError`
 * (#298). Relative targets ("/next", "?q=1", "#top") resolve against this
 * document and are always ours; an absolute or protocol-relative URL is ours
 * only when its origin matches.
 *
 * The comparison is against `new URL(location.href).origin`, not
 * `location.origin`: in an opaque-origin document (a sandboxed iframe, the
 * host the memory router exists for) the latter is the string `"null"` while
 * the document still resolves relative URLs against its real href — comparing
 * to it would classify every link in the app as off-origin. `"null"` never
 * counts as a match on either side, so a `javascript:` or `data:` target
 * cannot pass as same-origin in a document that is itself opaque.
 *
 * Without a document to resolve against (no `location`), or with a target that
 * will not parse even against one, nothing here can be decided and the target
 * is left to the router as before.
 */
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
  // One line, and the element stays out of it: this fires under `kumiki run`
  // and `kumiki smoke`, whose transcripts are read as text, and a DOM node
  // logged there prints as pages of internal symbols. The link's own text is
  // what locates it in the source anyway.
  const what =
    disposition === "browser"
      ? "is off-origin; the router cannot serve it, so the browser navigates it " +
        "(add `{external: true}`)"
      : "uses a scheme this runtime does not navigate to; the click was ignored";
  console.warn(
    `kumiki: link ${JSON.stringify(a.textContent ?? "")} -> ${JSON.stringify(to)} ${what}`,
  );
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

export const linkTile: TileRenderer<"link"> = (node) => {
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
    const state = LINK_STATE.get(a);
    const to = state?.to ?? node.to;
    // Decided BEFORE preventDefault, like the unresolved-app case below: a
    // target off this origin is one the router cannot serve (#298). Handing
    // it to `history.pushState` throws `SecurityError`, and by then the
    // click is already cancelled — the link is dead and the console names
    // the history API rather than the link.
    const disposition = linkDisposition(to);
    // `javascript:` and friends are the one target that is neither ours nor
    // the browser's to run. This branch is ahead of `external` on purpose:
    // `{external: true}` says "another page owns this", not "execute this".
    if (disposition === "unsafe") {
      e.preventDefault();
      warnLink(a, to, disposition);
      return;
    }
    // An external link leaves the app (§3.8): the router has no route for
    // where it goes, so it stays the browser's navigation.
    if (state?.external) return;
    // Nor does the router serve another origin — the browser keeps the click.
    if (disposition === "browser") {
      warnLink(a, to, disposition);
      return;
    }
    // Resolve BEFORE preventDefault: a link outside any live mount (stale
    // node, disposed app) degrades to the browser's native navigation via
    // `href` instead of becoming a dead link.
    const app = resolveApp(a);
    if (!app) {
      warnUnresolvedEvent(a, "link click; falling back to native navigation");
      return;
    }
    e.preventDefault();
    app._navigate(to, false);
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
};

export const linkPatcher: TilePatcher<"link"> = (el, _oldNode, newNode) => {
  const a = el as HTMLAnchorElement;
  if (a.getAttribute("href") !== newNode.to) a.href = newNode.to;
  if (a.textContent !== newNode.text) a.textContent = newNode.text;
  // Route the click listener at the CURRENT `to` — see LINK_STATE note.
  LINK_STATE.set(a, { to: newNode.to, external: isExternal(newNode.props) });
  applyExternal(a, newNode.props);
  // Do NOT re-arm prefetch. Prefetch is a fire-once side effect (§3.8),
  // and re-observing on every patch would defeat the dedupe by target URL.
};
