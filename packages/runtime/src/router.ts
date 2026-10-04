// Routing feature module (#71): router implementations (history / memory),
// route matching, and the navigation built-in effects. Loaded only by apps
// that actually route (routes declared, `link` tiles, or nav.* emits) — a
// counter-class app ships none of this.

import {
  type AppShape,
  type LocationLike,
  type NavContext,
  NONE,
  overridableInvoke,
  type ParsedRoute,
  type RedirectEntry,
  type Router,
  type RoutingImpl,
  someOf,
} from "./core.ts";

function historyRouter(): Router {
  return {
    read: () => ({ pathname: location.pathname, search: location.search, hash: location.hash }),
    push: (p) => history.pushState(null, "", p),
    replace: (p) => history.replaceState(null, "", p),
    back: () => history.back(),
    subscribe: (cb) => {
      const h = (): void => cb();
      window.addEventListener("popstate", h);
      return () => window.removeEventListener("popstate", h);
    },
  };
}

/**
 * Split a raw path into the `{ pathname, search, hash }` parseLocation reads.
 * The pathname is kept as written (`//foo`, `/a/../b`), as a browser's
 * `location.pathname` keeps it; SSR splits its requested route with this too,
 * so server and client match the same path.
 */
export function splitPath(p: string): LocationLike {
  let rest = p || "/";
  let hash = "";
  const hi = rest.indexOf("#");
  if (hi !== -1) {
    hash = rest.slice(hi);
    rest = rest.slice(0, hi);
  }
  let search = "";
  const qi = rest.indexOf("?");
  if (qi !== -1) {
    search = rest.slice(qi);
    rest = rest.slice(0, qi);
  }
  return { pathname: rest || "/", search, hash };
}

function memoryRouter(initialPath = "/"): Router {
  const stack: string[] = [initialPath || "/"];
  const listeners = new Set<() => void>();
  return {
    read: () => splitPath(stack[stack.length - 1] ?? "/"),
    push: (p) => {
      stack.push(p);
    },
    replace: (p) => {
      stack[stack.length - 1] = p;
    },
    back: () => {
      if (stack.length > 1) {
        stack.pop();
        for (const l of listeners) l();
      }
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

function parseLocation(routes: AppShape["routes"], loc: LocationLike): ParsedRoute {
  const path = loc.pathname || "/";
  const query: Record<string, string> = {};
  const params = new URLSearchParams(loc.search);
  for (const [k, v] of params.entries()) query[k] = v;
  // `Route.hash` is `Option(Text)` (routing.md §3.2), so it is built the way
  // every other Option is — a bare string here would match neither arm of a
  // `match route.hash`, and `is-some` would answer `false` for a hash that is
  // right there in the URL.
  const hash = loc.hash ? someOf(loc.hash.slice(1)) : NONE;
  if (!routes) return { path, pattern: path, params: {}, query, hash };
  for (const r of ranked(routes)) {
    if ("redirectTo" in r) continue;
    const m = matchPattern(r.pattern, path);
    if (m) {
      // §3.6: when the parent declares sub-routes, re-match within them.
      if (r.subRoutes && r.subRoutes.length > 0) {
        for (const sr of ranked(r.subRoutes)) {
          if ("redirectTo" in sr) continue;
          const cm = matchPattern(sr.pattern, path);
          if (cm)
            return {
              path,
              pattern: r.pattern,
              params: { ...m, ...cm },
              query,
              hash,
              childPattern: sr.pattern,
            };
        }
        // §3.6.3: no child matched — fall back to the parent's bare-path
        // sub-route (the default, e.g. `/settings` under `/settings/*`) if one
        // is declared. Otherwise fall through to the global /404.
        const bare = parentBare(r.pattern);
        if (bare !== null) {
          for (const sr of r.subRoutes) {
            if ("redirectTo" in sr) continue;
            if (sr.pattern === bare) {
              return {
                path,
                pattern: r.pattern,
                params: m,
                query,
                hash,
                childPattern: sr.pattern,
              };
            }
          }
        }
        return { path, pattern: "/404", params: {}, query, hash };
      }
      return { path, pattern: r.pattern, params: m, query, hash };
    }
  }
  // 404 fallback
  return { path, pattern: "/404", params: {}, query, hash };
}

/** Strip the trailing `/*` from a wildcard pattern; returns null if absent. */
function parentBare(pattern: string): string | null {
  return pattern.endsWith("/*") ? pattern.slice(0, -2) || "/" : null;
}

/**
 * Where the redirects send the given location, or `null` if none applies
 * (spec §3.10). A redirect does what a `navigate-replace` to its target would,
 * so a target that is itself redirected is redirected again: the chain is
 * followed, one `redirectStep` at a time, to a path no redirect owns, and that
 * path is the answer — the caller replaces the URL once, with it.
 */
function findRedirect(routes: AppShape["routes"], loc: LocationLike): string | null {
  if (!routes) return null;
  return followRedirects(loc.pathname || "/", (path) => redirectStep(routes, path));
}

/** The most redirects one chain may take — the limit browsers put on an HTTP redirect chain. */
const MAX_REDIRECTS = 20;

/**
 * Follow `step` from `start` until it answers `null`, and return the last path
 * it named — `null` if it named none. A chain that comes back to a path it has
 * already visited, or that needs more than `MAX_REDIRECTS` redirects, would
 * never end: it is reported on `console.error` (which the smoke and scenario
 * tiers fail on) and answers `null`, so no redirect applies to `start`.
 *
 * Exported for the SSR pass, which follows its literal redirects without a
 * routing module through this same loop.
 */
export function followRedirects(
  start: string,
  step: (path: string) => string | null,
): string | null {
  const chain = [start];
  for (let next = step(start); next !== null; next = step(next)) {
    const looped = chain.includes(next);
    chain.push(next);
    if (looped || chain.length > MAX_REDIRECTS + 1) {
      const what = looped ? "redirect loop" : `more than ${MAX_REDIRECTS} redirects`;
      console.error(`[kumiki] ${what}: ${chain.join(" ->> ")} — stopped, no redirect applied`);
      return null;
    }
  }
  return chain.length > 1 ? (chain[chain.length - 1] ?? null) : null;
}

/**
 * Where one redirect sends `path`, or `null` if no redirect owns it.
 * Redirects and rendering routes share one order (§3.1.2): the first entry of
 * `ranked(routes)` that matches the path owns it. If that entry is a `->>`,
 * its target is the answer; if it is a page, nothing redirects — unless the
 * page declares `sub-routes`, whose entries are resolved the same way, so a
 * child `->>` applies only when it is the child that owns the path
 * (spec §3.6 + §3.10).
 */
function redirectStep(routes: RouteList, path: string): string | null {
  const owner = firstMatch(routes, path);
  const entry =
    owner && !("redirectTo" in owner) && owner.subRoutes?.length
      ? firstMatch(owner.subRoutes, path)
      : owner;
  return entry && "redirectTo" in entry ? landing(entry, path) : null;
}

/**
 * The path `r` sends `path` to, given that `r.pattern` matches it: each `:name`
 * segment of the target takes the segment the same parameter matched in the
 * path, and a `*` segment takes the rest of the path the source's wildcard
 * matched — nothing at all when it matched none, so a `/help/*` target reached
 * from `/docs` is `/help`, and a `/*` target reached the same way is `/`.
 * Nothing in the source after a `*` binds, as nothing there is matched. A
 * segment is carried as the path has it, so the target's own match decodes it
 * once, as it would decode the same URL asked for directly. Every other segment
 * is kept as written; check reports a `:name` or `*` the source does not bind
 * (E0125).
 */
function landing(r: RedirectEntry, path: string): string {
  const segs = path.split("/").filter(Boolean);
  const bound = new Map<string, string>();
  for (const [i, p] of r.pattern.split("/").filter(Boolean).entries()) {
    if (p === "*") {
      bound.set(p, segs.slice(i).join("/"));
      break;
    }
    if (p.startsWith(":")) bound.set(p, segs[i] ?? "");
  }
  const out = r.redirectTo.split("/").flatMap((s) => {
    const v = bound.get(s);
    return v === undefined ? [s] : v === "" ? [] : [v];
  });
  return out.join("/") || "/";
}

/** The entry of `list` that owns `path`: its first match in §3.1.2's order. */
function firstMatch(list: RouteList, path: string): RouteList[number] | null {
  for (const r of ranked(list)) if (matchPattern(r.pattern, path)) return r;
  return null;
}

type RouteList = NonNullable<AppShape["routes"]>;

/** A segment's rank in §3.1.2's order: static 0, parameter 1, wildcard 2. */
function segmentRank(seg: string | undefined): number {
  // A pattern that ends here only matches a path that ends here too (the
  // length check at the end of `matchPattern`), which is as exact as a static
  // segment.
  if (seg === undefined) return 0;
  return seg === "*" ? 2 : seg.startsWith(":") ? 1 : 0;
}

/** Negative when `a` is the more specific pattern (§3.1.2), 0 on a tie. */
function compareSpecificity(a: string, b: string): number {
  const as = a.split("/").filter(Boolean);
  const bs = b.split("/").filter(Boolean);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const d = segmentRank(as[i]) - segmentRank(bs[i]);
    if (d !== 0) return d;
    // A wildcard swallows the rest of the path, so segments past it never compare.
    // Checking one side is enough: `d === 0` here and only `*` ranks 2, so
    // `bs[i]` is `*` as well.
    if (as[i] === "*") return 0;
  }
  return 0;
}

const rankedCache = new WeakMap<RouteList, RouteList>();

/**
 * `list` in match order (§3.1.2): most specific first, definition order among
 * equals (`sort` is stable). Every first-match lookup — the rendered route, its
 * sub-route, and the redirect that applies — walks this one order. (The §3.6.3
 * bare-path fallback looks a child up by exact pattern instead, where order
 * cannot matter: E0112 rejects two children with one pattern.)
 *
 * Cached by array identity, which assumes a route list is never mutated after
 * the app is created — codegen builds a fresh `_routes` per `createApp()`.
 */
function ranked(list: RouteList): RouteList {
  let out = rankedCache.get(list);
  if (!out) {
    out = [...list].sort((a, b) => compareSpecificity(a.pattern, b.pattern));
    rankedCache.set(list, out);
  }
  return out;
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  if (pattern === "/404") return null;
  const patSegs = pattern.split("/").filter(Boolean);
  const pathSegs = path.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  // Wildcard `/*` matches everything from that point on.
  for (let i = 0; i < patSegs.length; i++) {
    const p = patSegs[i]!;
    if (p === "*") return params;
    const s = pathSegs[i];
    if (s === undefined) return null;
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(s);
    } else if (p !== s) {
      return null;
    }
  }
  if (pathSegs.length !== patSegs.length) return null;
  return params;
}

function buildPath(x: {
  path: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}): string {
  let p = x.path;
  if (x.params) {
    for (const [k, v] of Object.entries(x.params)) {
      p = p.replace(`{${k}}`, encodeURIComponent(v));
      p = p.replace(`:${k}`, encodeURIComponent(v));
    }
  }
  if (x.query) {
    const q = new URLSearchParams(x.query).toString();
    if (q) p += `?${q}`;
  }
  return p;
}

function installNavEffects(app: AppShape, nav: NavContext): void {
  app.effects.navigate = {
    name: "navigate",
    cap: "nav.push",
    invoke: overridableInvoke("nav.push", async (input) => {
      const x = input as {
        path: string;
        params?: Record<string, string>;
        query?: Record<string, string>;
      };
      nav.navigate(buildPath(x), false);
      return { kind: "ok", value: null };
    }),
  };
  app.effects["navigate-replace"] = {
    name: "navigate-replace",
    cap: "nav.replace",
    invoke: overridableInvoke("nav.replace", async (input) => {
      const x = input as {
        path: string;
        params?: Record<string, string>;
        query?: Record<string, string>;
      };
      nav.navigate(buildPath(x), true);
      return { kind: "ok", value: null };
    }),
  };
  app.effects["navigate-back"] = {
    name: "navigate-back",
    cap: "nav.back",
    invoke: overridableInvoke("nav.back", async () => {
      nav.back();
      return { kind: "ok", value: null };
    }),
  };
  // §3.9 scroll-to — the one standard effect with no capability gate. It moves
  // the viewport of the page the user is already looking at and reaches nothing
  // outside it, which `confirm` and `toast` (both on `notification.show`) do
  // not: those put up UI of their own. `window.scrollTo` is a no-op in headless
  // DOMs, so it stays safe under smoke / scenario runs.
  app.effects["scroll-to"] = {
    name: "scroll-to",
    cap: "",
    invoke: overridableInvoke("", async (input) => {
      const xy = input as { x?: number; y?: number };
      const x = typeof xy?.x === "number" ? xy.x : 0;
      const y = typeof xy?.y === "number" ? xy.y : 0;
      if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
        window.scrollTo(x, y);
      }
      return { kind: "ok", value: null };
    }),
  };
}

/** The routing module surface consumed by `mountCore` (see core `RoutingImpl`). */
export const routing: RoutingImpl = {
  createRouter(mode, initialPath) {
    return mode === "memory" ? memoryRouter(initialPath) : historyRouter();
  },
  parseLocation,
  matchPattern,
  findRedirect,
  href({ path, query, hash }) {
    const search = new URLSearchParams(query).toString();
    return path + (search && `?${search}`) + (hash._tag === "Some" ? `#${hash._0}` : "");
  },
  installNavEffects,
};
