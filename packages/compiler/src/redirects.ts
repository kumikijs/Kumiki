// Which entry owns a path a parameter or a wildcard matched is a question about a URL, so only the
// runtime can answer it; this decides what the route table alone can.

import type { Pos } from "./ast.ts";

export type RouteMapEntry = { path: string; tile: string; pathPos: Pos };

function targetOf(entry: RouteMapEntry): string | null {
  return entry.tile.startsWith(">>") ? entry.tile.slice(2) : null;
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

/** The runtime substitutes only what the source bound, so any other `:name` or `*` would land in the URL as written. */
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

function isStatic(path: string): boolean {
  return path.split("/").every((seg) => seg !== "*" && !seg.startsWith(":"));
}

/** `loop` starts and ends with the path of the entry on the cycle declared first. */
export type RedirectCycle = { first: RouteMapEntry; loop: string[] };

/**
 * A static pattern owns the path it names within its map, and of two entries for one pattern the
 * one declared first owns it, as at run time. `/404` is never matched, so a redirect there owns
 * nothing.
 */
export function redirectCycles(entries: readonly RouteMapEntry[]): RedirectCycle[] {
  const next = new Map<string, string>();
  const owned = new Set<string>();
  for (const e of entries) {
    if (owned.has(e.path)) continue;
    owned.add(e.path);
    const target = targetOf(e);
    if (target === null || e.path === "/404") continue;
    // A target is followed by looking it up here, and one with a parameter or a wildcard names no key.
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
    // Ran into a path an earlier walk took, whose cycle, if any, is already found.
    const from = at === undefined ? -1 : chain.indexOf(at);
    if (from === -1) continue;
    const cycle = chain.slice(from);
    const first = entries.find((e) => cycle.includes(e.path));
    if (!first) continue;
    const i = cycle.indexOf(first.path);
    out.push({ first, loop: [...cycle.slice(i), ...cycle.slice(0, i), first.path] });
  }
  return out;
}
