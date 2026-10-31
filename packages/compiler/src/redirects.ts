// Which entry owns a path a parameter or a wildcard matched is a question about a URL, so only the
// runtime can answer it; this decides what the route table alone can.

import type { Pos } from "./ast.ts";

export type RouteMapEntry = { path: string; tile: string; pathPos: Pos };

function targetOf(entry: RouteMapEntry): string | null {
  return entry.tile.startsWith(">>") ? entry.tile.slice(2) : null;
}

/** A target's path, without the query or the hash it may carry to where it lands. */
function pathOf(target: string): string {
  const cut = target.search(/[?#]/);
  return cut === -1 ? target : target.slice(0, cut);
}

const BASE_ORIGIN = "http://router.invalid";

/**
 * The path `pattern` names as the runtime matches it, segment by segment, so `/a/` and `/a` are one
 * path; a relative target is resolved against `from`, the path it redirects from.
 */
function keyOf(pattern: string, from = "/"): string {
  let pathname = pathOf(pattern);
  try {
    pathname = new URL(pathname, BASE_ORIGIN + from).pathname;
  } catch {
    // Not a URL even against `from`; the segments are read as written.
  }
  return `/${pathname.split("/").filter(Boolean).join("/")}`;
}

/** Nothing after a `*` binds: the wildcard has taken the rest of the path, where the runtime's match stops too. */
function boundBy(pattern: string): Set<string> {
  const bound = new Set<string>();
  for (const seg of pattern.split("/")) {
    if (seg === "*") {
      bound.add(seg);
      break;
    }
    if (seg.startsWith(":")) bound.add(seg);
  }
  return bound;
}

export type UnboundRedirectName = { entry: RouteMapEntry; target: string; name: string };

/**
 * The runtime substitutes only what the source bound, so any other `:name` or `*` would land in the
 * URL as written. An entry written at `/404` is never followed, and is E0001 whatever it targets.
 */
export function unboundRedirectNames(entries: readonly RouteMapEntry[]): UnboundRedirectName[] {
  const out: UnboundRedirectName[] = [];
  for (const entry of entries) {
    if (entry.path === "/404") continue;
    const target = targetOf(entry);
    if (target === null) continue;
    const bound = boundBy(entry.path);
    const named = new Set<string>();
    for (const name of pathOf(target).split("/")) {
      if (name !== "*" && !name.startsWith(":")) continue;
      if (bound.has(name) || named.has(name)) continue;
      named.add(name);
      out.push({ entry, target, name });
    }
  }
  return out;
}

function isStatic(path: string): boolean {
  return path.split("/").every((seg) => seg !== "*" && !seg.startsWith(":"));
}

/** The paths the static patterns of `entries` own, which a `sub-routes` map below them never sees. */
export function staticPaths(entries: readonly RouteMapEntry[]): Set<string> {
  return new Set(
    entries.filter((e) => e.path !== "/404" && isStatic(e.path)).map((e) => keyOf(e.path)),
  );
}

/** `loop` starts and ends with the path of the entry on the cycle declared first. */
export type RedirectCycle = { first: RouteMapEntry; loop: string[] };

/**
 * A static pattern owns the path it names within its map, and of two entries for one path the one
 * declared first owns it, as at run time. A path in `ownedElsewhere` belongs to another map's static
 * route, so no redirect of this map applies there. An entry written at `/404` is never matched and
 * owns nothing, and a chain that reaches the path `/404` ends there.
 */
export function redirectCycles(
  entries: readonly RouteMapEntry[],
  ownedElsewhere: ReadonlySet<string> = new Set(),
): RedirectCycle[] {
  const next = new Map<string, string>();
  const ownerOf = new Map<string, RouteMapEntry>();
  const owned = new Set(ownedElsewhere);
  for (const e of entries) {
    if (e.path === "/404") continue;
    const key = keyOf(e.path);
    if (owned.has(key)) continue;
    owned.add(key);
    const target = targetOf(e);
    // A source with a parameter or a wildcard names more than one path, so no walk starts there; a
    // target with one is no key, so the walk ends there.
    if (target === null || !isStatic(e.path)) continue;
    next.set(key, keyOf(target, e.path));
    ownerOf.set(key, e);
  }
  const out: RedirectCycle[] = [];
  const walked = new Set<string>();
  for (const start of next.keys()) {
    if (walked.has(start)) continue;
    const chain: string[] = [];
    let at: string | undefined = start;
    while (at !== undefined && !walked.has(at)) {
      walked.add(at);
      chain.push(at);
      at = next.get(at);
    }
    // Ran into a path an earlier walk took, whose cycle, if any, is already found.
    const from = at === undefined ? -1 : chain.indexOf(at);
    if (from === -1) continue;
    const cycle = chain.slice(from);
    const first = entries.find((e) => cycle.some((key) => ownerOf.get(key) === e));
    if (!first) continue;
    const i = cycle.indexOf(keyOf(first.path));
    out.push({ first, loop: [...cycle.slice(i), ...cycle.slice(0, i), cycle[i] ?? first.path] });
  }
  return out;
}
