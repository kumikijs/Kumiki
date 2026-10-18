import type { AppShape, HoldLeave, ParsedRoute, RouteEntry, Router, RoutingImpl } from "./types.ts";

/** A move a leave guard's `confirm` holds, and how to close every dialog its guards opened. */
type HeldMove = { oldRoute: ParsedRoute; newRoute: ParsedRoute; closes: (() => void)[] };

export type Navigation = {
  navigate(path: string, replace: boolean): void;
  back(): void;
  /** Called by every `confirm` modal as it opens; see `HoldLeave`. */
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
  fireRouteEvent: (kind: "enter" | "leave", route: ParsedRoute) => void;
  render: () => void;
}): Navigation {
  const { app, slots, routing, router, fireRouteEvent, render } = deps;
  let pendingLeave: HeldMove | null = null;
  let leaving: HeldMove | null = null;
  // Bumped by every sync, so one that a leave guard's own navigation overtook stops there.
  let generation = 0;
  const scrollSaved = new Map<string, { x: number; y: number }>();
  let lastNavSource: "push" | "replace" | "pop" = "push";
  let unsubscribe: (() => void) | undefined;

  const enter = (route: ParsedRoute): void => {
    slots.route = route;
    fireRouteEvent("enter", route);
    applyScrollFor(route);
    render();
  };

  const closeAll = (move: HeldMove | null): void => {
    for (const close of move?.closes ?? []) close();
  };

  function syncRouteFromLocation(): void {
    if (!routing || !router) return;
    const gen = ++generation;
    // A navigation while a move is held replaces it. The held move never committed, so this one
    // starts from the route still shown.
    const dropped = pendingLeave;
    pendingLeave = null;
    closeAll(dropped);
    const redirectTo = routing.findRedirect(app.routes, router.read());
    if (redirectTo !== null) router.replace(redirectTo);
    const oldRoute = slots.route as ParsedRoute;
    const newRoute = routing.parseLocation(app.routes, router.read());
    // Back to the location still shown only withdraws the held move: nothing was left, so
    // nothing is entered.
    if (dropped && oldRoute && routing.href(newRoute) === routing.href(oldRoute)) {
      slots.route = newRoute;
      render();
      return;
    }
    if (oldRoute && typeof window !== "undefined") {
      const x = typeof window.scrollX === "number" ? window.scrollX : 0;
      const y = typeof window.scrollY === "number" ? window.scrollY : 0;
      scrollSaved.set(oldRoute.path, { x, y });
    }
    if (oldRoute && oldRoute.path !== newRoute.path) {
      const move: HeldMove = { oldRoute, newRoute, closes: [] };
      leaving = move;
      try {
        fireRouteEvent("leave", oldRoute);
      } finally {
        leaving = null;
      }
      // A guard's own navigation ran its sync inside the one above, and that one has the last word.
      if (gen !== generation) return;
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
    // One answer settles the move, so the other guards' dialogs close unanswered.
    closeAll(p);
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
    // A modal opens inside the dispatch that emitted its `confirm`, so one opening while the
    // guards run is a guard's own, and a `confirm` another reducer opens later cannot settle it.
    holdLeave(close) {
      const move = leaving;
      if (!move || pendingLeave !== move) return undefined;
      move.closes.push(close);
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
      // A dialog left open would outlive the app, and its answer would still move the router.
      const held = pendingLeave;
      pendingLeave = null;
      closeAll(held);
    },
  };
}
