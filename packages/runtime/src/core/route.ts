import { isPanic } from "./panic.ts";
import {
  type AppShape,
  NONE,
  type OutletFill,
  type ParsedRoute,
  type RouteEntry,
  type TileNode,
} from "./types.ts";

export function emptyRoute(): ParsedRoute {
  return { path: "/", pattern: "/", params: {}, query: {}, hash: NONE };
}

function injectRouteOutlet(node: TileNode, child: TileNode): boolean {
  if (!node || typeof node !== "object") return false;
  if ((node as { kind?: string }).kind === "route-outlet") {
    (node as { children: TileNode[] }).children = [child];
    return true;
  }
  const children = (node as { children?: TileNode[] }).children;
  if (Array.isArray(children)) {
    for (const c of children) {
      if (injectRouteOutlet(c, child)) return true;
    }
  }
  return false;
}

export function pickRootTile(app: AppShape, slotValues: Record<string, unknown>): TileNode {
  if (app.routes && app.routes.length > 0) {
    const cur = slotValues.route as ParsedRoute;
    for (const r of app.routes) {
      if (r.pattern === cur.pattern && "tile" in r) {
        const childEntry =
          cur.childPattern && r.subRoutes
            ? r.subRoutes.find(
                (sr): sr is RouteEntry => "tile" in sr && sr.pattern === cur.childPattern,
              )
            : undefined;
        if (!childEntry) return routeTree(r, keepTree);
        const fill: OutletFill = (tree) => {
          if (!injectRouteOutlet(tree, routeTree(childEntry, keepTree))) {
            console.error(
              `[kumiki] route "${r.pattern}" matched sub-route "${childEntry.pattern}" but tile "${r.name ?? r.pattern}" rendered no route-outlet — the child was discarded`,
            );
          }
          return tree;
        };
        const root = routeTree(r, fill);
        return r.tile.length === 0 ? fill(root) : root;
      }
    }
    for (const r of app.routes) {
      if (r.pattern === "/404" && "tile" in r) return routeTree(r, keepTree);
    }
  }
  return app.root ? app.root() : { kind: "text", text: "(no root)" };
}

/** The fill for a factory whose outlet has nothing to show (or that has none). */
const keepTree: OutletFill = (tree) => tree;

function routeTree(entry: RouteEntry, fill: OutletFill): TileNode {
  try {
    return entry.tile(fill);
  } catch (e) {
    if (isPanic(e) && entry.name !== undefined) {
      try {
        if (e.location === undefined) e.location = entry.name;
      } catch {
        // host-frozen panic: attribution is best-effort
      }
    }
    throw e;
  }
}
