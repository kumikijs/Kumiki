import type { AppShape, HoldLeave, ParsedRoute, RouteEntry, Router, RoutingImpl } from "./types.ts";

type HeldMove = { oldRoute: ParsedRoute; newRoute: ParsedRoute; close?: () => void };

export type Navigation = {
  navigate(path: string, replace: boolean): void;
  back(): void;
  /** The hook a `confirm` modal opening while a `route.leave` handler holds a move calls. */
  holdLeave: HoldLeave;
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
  fireLifecycle: (name: string, payload: Record<string, unknown>) => void;
  render: () => void;
}): Navigation {
  const { app, slots, routing, router, fireLifecycle, render } = deps;
  let pendingLeave: HeldMove | null = null;
  let leaving: HeldMove | null = null;
  const scrollSaved = new Map<string, { x: number; y: number }>();
  let lastNavSource: "push" | "replace" | "pop" = "push";
  let unsubscribe: (() => void) | undefined;

  const enter = (route: ParsedRoute): void => {
    slots.route = route;
    fireLifecycle(`route.enter(${JSON.stringify(route.pattern)})`, { $route: route });
    applyScrollFor(route);
    render();
  };

  function syncRouteFromLocation(): void {
    if (!routing || !router) return;
    // A navigation while a move is held replaces it. The held move never
    // committed, so this one leaves the route still shown, guards and all.
    const dropped = pendingLeave;
    pendingLeave = null;
    dropped?.close?.();
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
      const move: HeldMove = { oldRoute, newRoute };
      leaving = move;
      try {
        fireLifecycle(`route.leave(${JSON.stringify(oldRoute.pattern)})`, { $route: oldRoute });
      } finally {
        leaving = null;
      }
      if (pendingLeave === move) {
        render();
        return;
      }
    }
    enter(newRoute);
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

  function resolveLeave(p: HeldMove, outcome: "yes" | "no"): void {
    if (pendingLeave !== p) return;
    pendingLeave = null;
    if (outcome === "yes") {
      enter(p.newRoute);
      return;
    }
    // `replace` notifies no subscriber, so the leave guard does not run again.
    if (routing) router?.replace(routing.href(p.oldRoute));
    slots.route = p.oldRoute;
    render();
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
    // Only the first modal opened for a held move settles it, so a `confirm`
    // another reducer opens meanwhile cannot answer the guard's question.
    holdLeave(close) {
      const move = pendingLeave;
      if (!move || move.close) return undefined;
      move.close = close;
      return (outcome) => resolveLeave(move, outcome);
    },
    noteEmit(effect) {
      // Held before the dispatch, so the modal the confirm opens finds the move it answers.
      if (leaving && effect === "confirm") pendingLeave = leaving;
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
