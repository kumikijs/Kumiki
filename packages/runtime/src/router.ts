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

/** A router location has no origin of its own, and `.invalid` (RFC 2606) is one no real target can name. */
const BASE_ORIGIN = "http://router.invalid";

/** A target that names an origin of its own (`https://…`, `mailto:`) is left as written: resolving it would drop that origin. */
function resolveTarget(to: string, at: LocationLike): string {
  if (to[0] === "/") return to;
  try {
    const url = new URL(to, BASE_ORIGIN + at.pathname + at.search + at.hash);
    if (url.origin === BASE_ORIGIN) return url.pathname + url.search + url.hash;
  } catch {
    // Not a URL even against `at` (`http://[`).
  }
  return to;
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
  const hash = loc.hash ? someOf(loc.hash.slice(1)) : NONE;
  if (!routes) return { path, pattern: path, params: {}, query, hash };
  for (const r of ranked(routes)) {
    if ("redirectTo" in r) continue;
    const m = matchPattern(r.pattern, path);
    if (m) {
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
  return { path, pattern: "/404", params: {}, query, hash };
}

/** Strip the trailing `/*` from a wildcard pattern; returns null if absent. */
function parentBare(pattern: string): string | null {
  return pattern.endsWith("/*") ? pattern.slice(0, -2) || "/" : null;
}

function findRedirect(routes: AppShape["routes"], loc: LocationLike): string | null {
  if (!routes) return null;
  const path = loc.pathname || "/";
  const owner = firstMatch(routes, path);
  if (!owner) return null;
  if ("redirectTo" in owner) return owner.redirectTo;
  if (!owner.subRoutes || owner.subRoutes.length === 0) return null;
  const child = firstMatch(owner.subRoutes, path);
  return child && "redirectTo" in child ? child.redirectTo : null;
}

/** The entry of `list` that owns `path`: its first match in specificity order. */
function firstMatch(list: RouteList, path: string): RouteList[number] | null {
  for (const r of ranked(list)) if (matchPattern(r.pattern, path)) return r;
  return null;
}

type RouteList = NonNullable<AppShape["routes"]>;

/** A segment's rank in specificity order: static 0, parameter 1, wildcard 2. */
function segmentRank(seg: string | undefined): number {
  if (seg === undefined) return 0;
  return seg === "*" ? 2 : seg.startsWith(":") ? 1 : 0;
}

/** Negative when `a` is the more specific pattern, 0 on a tie. */
function compareSpecificity(a: string, b: string): number {
  const as = a.split("/").filter(Boolean);
  const bs = b.split("/").filter(Boolean);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const d = segmentRank(as[i]) - segmentRank(bs[i]);
    if (d !== 0) return d;
    if (as[i] === "*") return 0;
  }
  return 0;
}

const rankedCache = new WeakMap<RouteList, RouteList>();

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

function href({ path, query, hash }: ParsedRoute): string {
  const search = new URLSearchParams(query).toString();
  return path + (search && `?${search}`) + (hash._tag === "Some" ? `#${hash._0}` : "");
}

/** The element is looked up by the hash as written and then percent-decoded, as a browser finds a fragment's target. */
function jump(from: ParsedRoute, to: ParsedRoute, root: Node): (() => void) | undefined {
  if (to.hash._tag !== "Some") return undefined;
  if (href({ ...from, hash: NONE }) !== href({ ...to, hash: NONE })) return undefined;
  const id = to.hash._0;
  return () => {
    const scope = root.getRootNode() as Partial<Pick<Document, "getElementById">>;
    let el = scope.getElementById?.(id);
    try {
      el ??= scope.getElementById?.(decodeURIComponent(id));
    } catch {
      // A malformed escape (`#100%`): the hash as written was the only name.
    }
    el?.scrollIntoView();
  };
}

/** The routing module surface consumed by `mountCore` (see core `RoutingImpl`). */
export const routing: RoutingImpl = {
  createRouter(mode, initialPath) {
    const router = mode === "memory" ? memoryRouter(initialPath) : historyRouter();
    const resolving =
      (go: (path: string) => void) =>
      (path: string): void =>
        go(resolveTarget(path, router.read()));
    return { ...router, push: resolving(router.push), replace: resolving(router.replace) };
  },
  parseLocation,
  matchPattern,
  findRedirect,
  href,
  jump,
  installNavEffects,
};
