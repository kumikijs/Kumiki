// routing.md §3.10: what check can decide about a route map's `->>` entries
// from the table alone. A target names only what its source binds, and a chain
// of redirects written for static paths reaches a path none of them owns. Which
// entry owns a path a parameter or a wildcard matched is a question about a
// URL; the runtime answers it, and stops the loops this cannot see
// (`followRedirects` in @kumikijs/runtime's router). The checker turns what is
// found here into E0125 and E0010.

import type { Pos } from "./ast.ts";

/** An entry of a route map: the app's `routes`, or one tile's `sub-routes`. */
export type RouteMapEntry = { path: string; tile: string; pathPos: Pos };

/** The target a redirect entry names, or `null` for an entry that renders a tile. */
function targetOf(entry: RouteMapEntry): string | null {
  return entry.tile.startsWith(">>") ? entry.tile.slice(2) : null;
}

/**
 * The segments a source pattern binds for its target: each `:name`, and `*`
 * for the rest of the path. Nothing after a `*` binds — the wildcard has taken
 * the rest of the path by then, which is where the runtime's match stops too.
 */
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

/** A `:name` or `*` segment a redirect's target names and its source does not bind. */
export type UnboundRedirectName = { entry: RouteMapEntry; target: string; name: string };

/**
 * Each `:name` or `*` segment of a redirect target that its source does not
 * bind, once per name per entry. The runtime substitutes only what the source
 * bound, so such a segment would land in the URL as written.
 */
export function unboundRedirectNames(entries: readonly RouteMapEntry[]): UnboundRedirectName[] {
  const out: UnboundRedirectName[] = [];
  for (const entry of entries) {
    const target = targetOf(entry);
    if (target === null) continue;
    const bound = boundBy(entry.path);
    const named = new Set<string>();
    for (const name of target.split("/")) {
      if (name !== "*" && !name.startsWith(":")) continue;
      if (bound.has(name) || named.has(name)) continue;
      named.add(name);
      out.push({ entry, target, name });
    }
  }
  return out;
}

/** Whether `path` names exactly one path: no parameter and no wildcard segment. */
function isStatic(path: string): boolean {
  return path.split("/").every((seg) => seg !== "*" && !seg.startsWith(":"));
}

/** Redirects that send a path back to itself, read from the entry on the cycle declared first. */
export type RedirectCycle = { first: RouteMapEntry; loop: string[] };

/**
 * Each cycle of redirects whose targets are the static sources of other
 * redirects in the same map. A static pattern owns the path it names within its
 * map — it outranks every parameter and wildcard that matches the same path
 * (§3.1.2), and of two entries for one pattern (E0008 / E0112) the one declared
 * first owns it, here as at run time. `/404` is never matched, being the
 * fallback, so a redirect written there owns nothing.
 *
 * Found once per cycle, from the entry on it declared first: `loop` starts and
 * ends with that entry's path.
 */
export function redirectCycles(entries: readonly RouteMapEntry[]): RedirectCycle[] {
  const next = new Map<string, string>();
  const owned = new Set<string>();
  for (const e of entries) {
    if (owned.has(e.path)) continue;
    owned.add(e.path);
    const target = targetOf(e);
    if (target === null || e.path === "/404") continue;
    // Only a static source is a step: a target is followed by looking it up
    // here, and a target with a parameter or a wildcard names no key.
    if (isStatic(e.path)) next.set(e.path, target);
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
    // The walk ended on a path no redirect here owns, or ran into one an
    // earlier walk took — whose cycle, if it has one, is already found.
    const from = at === undefined ? -1 : chain.indexOf(at);
    if (from === -1) continue;
    const cycle = chain.slice(from);
    const first = entries.find((e) => cycle.includes(e.path));
    // Unreachable — every path on the cycle is an entry's — and present for the type.
    if (!first) continue;
    const i = cycle.indexOf(first.path);
    out.push({ first, loop: [...cycle.slice(i), ...cycle.slice(0, i), first.path] });
  }
  return out;
}
