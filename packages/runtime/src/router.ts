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

/** Split a raw path into the `{ pathname, search, hash }` parseLocation reads. */
function splitPath(p: string): LocationLike {
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
  // First pass: non-redirect routes.
  for (const r of routes) {
    if ("redirectTo" in r) continue;
    const m = matchPattern(r.pattern, path);
    if (m) {
      // §3.6: when the parent declares sub-routes, re-match within them.
      if (r.subRoutes && r.subRoutes.length > 0) {
        for (const sr of r.subRoutes) {
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
 * Walk the routes table and return the redirect target for the given location,
 * or `null` if nothing redirects. Top-level `->>` entries take precedence; if
 * none apply, the first parent whose wildcard pattern matches the path is
 * scanned for sub-route redirects (spec §3.6 + §3.10).
 */
function findRedirect(routes: AppShape["routes"], loc: LocationLike): string | null {
  if (!routes) return null;
  const path = loc.pathname || "/";
  for (const r of routes) {
    if ("redirectTo" in r) {
      if (matchPattern(r.pattern, path)) return r.redirectTo;
    }
  }
  for (const r of routes) {
    if ("redirectTo" in r) continue;
    if (!r.subRoutes) continue;
    if (matchPattern(r.pattern, path)) {
      for (const sr of r.subRoutes) {
        if ("redirectTo" in sr && matchPattern(sr.pattern, path)) return sr.redirectTo;
      }
      // Only the FIRST matching parent owns the path — stop scanning here.
      return null;
    }
  }
  return null;
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
  installNavEffects,
};
