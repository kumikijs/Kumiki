// The router's match order (docs/spec/routing.md), read off the route table. Which entry owns one
// URL is the runtime's to decide; when every URL a pattern matches goes to the same entry ahead of
// another, the table alone says so. `segmentRank` and `compareSpecificity` are the ranking of the
// runtime's router (packages/runtime/src/router.ts), so a change to one belongs in the other.

import type { RouteMapEntry } from "./redirects.ts";

/** A segment's rank in specificity order: static 0, parameter 1, wildcard 2. */
function segmentRank(seg: string | undefined): number {
  if (seg === undefined) return 0;
  return seg === "*" ? 2 : seg.startsWith(":") ? 1 : 0;
}

/** Negative when `a` is the more specific pattern, 0 on a tie: the runtime router's ranking. */
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

/**
 * Whether `outer` matches every path `inner` matches. A `*` matches the rest of the path, even when
 * nothing is left, and a parameter any one segment. Two static segments are one only when spelled
 * alike, so a pair the URL parser would write alike is read as two, and nothing is reported for it.
 */
function matchesEveryPathOf(outer: string, inner: string): boolean {
  const os = outer.split("/").filter(Boolean);
  const is = inner.split("/").filter(Boolean);
  for (let i = 0; ; i++) {
    const o = os[i];
    const n = is[i];
    if (o === "*") return true;
    // `inner` goes on to paths of every length from here; `outer` matches one shape.
    if (n === "*") return false;
    if (o === undefined || n === undefined) return o === n;
    if (!o.startsWith(":") && o !== n) return false;
  }
}

/** A wildcard parent's pattern without its `/*`: the key of the child it renders by default. */
function parentBare(pattern: string): string | null {
  return pattern.endsWith("/*") ? pattern.slice(0, -2) || "/" : null;
}

/**
 * The entry of `routes` that takes every path `child` can render at ahead of each of `parents`, the
 * entries that render the tile `child` is a sub-route of; the first in match order when several do.
 * Ties keep definition order, as at run time. A redirect counts: it owns the paths it matches as a
 * rendering route does, even where its chain loops and the runtime applies none of it. The `/404`
 * entry is never matched, and a child written at `/404` matches no path, so neither takes part.
 */
export function shadowingRoute(
  child: RouteMapEntry,
  parents: readonly RouteMapEntry[],
  routes: readonly RouteMapEntry[],
): RouteMapEntry | null {
  if (child.path === "/404" || parents.length === 0) return null;
  // A parent's default child, the `->` key at its bare path, renders at every path of the parent
  // that no other sub-route matches, so only an entry that takes every path of the parent hides it.
  const reached = [child.path];
  if (!child.tile.startsWith(">>")) {
    for (const p of parents) if (parentBare(p.path) === child.path) reached.push(p.path);
  }
  const ahead = (a: RouteMapEntry, b: RouteMapEntry): boolean => {
    const d = compareSpecificity(a.path, b.path);
    return d < 0 || (d === 0 && routes.indexOf(a) < routes.indexOf(b));
  };
  let owner: RouteMapEntry | null = null;
  for (const r of routes) {
    // A parent never ranks ahead of itself, so it is never the one that takes the child's paths.
    if (r.path === "/404" || !parents.every((p) => ahead(r, p))) continue;
    if (!reached.every((inner) => matchesEveryPathOf(r.path, inner))) continue;
    if (owner === null || ahead(r, owner)) owner = r;
  }
  return owner;
}
