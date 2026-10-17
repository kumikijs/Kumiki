import type { AppShape, ParsedRoute, RouteEntry, Router, RoutingImpl } from "./types.ts";

export type Navigation = {
  navigate(path: string, replace: boolean): void;
  back(): void;
  /** Settle a navigation a `route.leave` handler held for a `confirm`. */
  resolveLeave(outcome: "yes" | "no"): void;
  /** Called for every emitted effect, so a `confirm` raised while leaving holds the navigation. */
  noteEmit(effect: string): void;
  /** Read the initial location and follow out-of-band changes (browser back/forward). */
  start(): void;
  dispose(): void;
};

export function createNavigation(deps: {
  app: AppShape;
  slots: Record<string, unknown>;
  routing: RoutingImpl | undefined;
  router: Router | null;
  /** Where an in-page jump looks up the element its hash names. */
  root: Node;
  fireLifecycle: (name: string, payload: Record<string, unknown>) => void;
  render: () => void;
}): Navigation {
  const { app, slots, routing, router, root, fireLifecycle, render } = deps;
  let pendingLeave: { oldRoute: ParsedRoute; newRoute: ParsedRoute } | null = null;
  let leaving = false;
  let leaveAskedConfirm = false;
  const scrollSaved = new Map<string, { x: number; y: number }>();
  let lastNavSource: "push" | "replace" | "pop" = "push";
  let unsubscribe: (() => void) | undefined;

  /** An in-page jump runs no `route.enter` and no scroll to the top; it calls `jump` once the page is painted. */
  const enter = (route: ParsedRoute, jump?: () => void): void => {
    slots.route = route;
    if (!jump) {
      fireLifecycle(`route.enter(${JSON.stringify(route.pattern)})`, { $route: route });
      applyScrollFor(route);
    }
    render();
    jump?.();
  };

  function syncRouteFromLocation(): void {
    if (!routing || !router) return;
    if (pendingLeave) return;
    const redirectTo = routing.findRedirect(app.routes, router.read());
    if (redirectTo !== null) router.replace(redirectTo);
    const oldRoute = slots.route as ParsedRoute;
    const newRoute = routing.parseLocation(app.routes, router.read());
    if (oldRoute && typeof window !== "undefined") {
      const x = typeof window.scrollX === "number" ? window.scrollX : 0;
      const y = typeof window.scrollY === "number" ? window.scrollY : 0;
      scrollSaved.set(oldRoute.path, { x, y });
    }
    if (oldRoute && oldRoute.path !== newRoute.path) {
      leaving = true;
      leaveAskedConfirm = false;
      try {
        fireLifecycle(`route.leave(${JSON.stringify(oldRoute.pattern)})`, { $route: oldRoute });
      } finally {
        leaving = false;
      }
      if (leaveAskedConfirm) {
        pendingLeave = { oldRoute, newRoute };
        render();
        return;
      }
    }
    enter(newRoute, routing.jump(oldRoute, newRoute, root));
  }

  function findRouteEntry(route: ParsedRoute): RouteEntry | undefined {
    for (const r of app.routes ?? []) {
      if ("redirectTo" in r || r.pattern !== route.pattern) continue;
      if (route.childPattern && r.subRoutes) {
        for (const sr of r.subRoutes) {
          if (!("redirectTo" in sr) && sr.pattern === route.childPattern) return sr;
        }
      }
      return r;
    }
    return undefined;
  }

  function applyScrollFor(route: ParsedRoute): void {
    if (typeof window === "undefined" || typeof window.scrollTo !== "function") return;
    if (findRouteEntry(route)?.scrollRestoration === false) return;
    const saved = lastNavSource === "pop" ? scrollSaved.get(route.path) : undefined;
    window.scrollTo(saved?.x ?? 0, saved?.y ?? 0);
  }

  return {
    navigate(path, replace) {
      if (!router) return;
      lastNavSource = replace ? "replace" : "push";
      if (replace) router.replace(path);
      else router.push(path);
      syncRouteFromLocation();
    },
    back() {
      router?.back();
    },
    resolveLeave(outcome) {
      const p = pendingLeave;
      if (!p) return;
      pendingLeave = null;
      if (outcome === "yes") {
        enter(p.newRoute);
        return;
      }
      if (routing) router?.replace(routing.href(p.oldRoute));
      slots.route = p.oldRoute;
      render();
    },
    noteEmit(effect) {
      if (leaving && effect === "confirm") leaveAskedConfirm = true;
    },
    start() {
      if (!routing || !router || !app.routes || app.routes.length === 0) return;
      if (typeof history !== "undefined" && "scrollRestoration" in history) {
        try {
          history.scrollRestoration = "manual";
        } catch {
          // Some embedded contexts (sandboxed iframes) forbid the write.
        }
      }
      const redirectTo = routing.findRedirect(app.routes, router.read());
      if (redirectTo !== null) router.replace(redirectTo);
      slots.route = routing.parseLocation(app.routes, router.read());
      unsubscribe = router.subscribe(() => {
        lastNavSource = "pop";
        syncRouteFromLocation();
      });
    },
    dispose() {
      unsubscribe?.();
    },
  };
}
