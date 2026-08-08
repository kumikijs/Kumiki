// Which definitions is a definition written in terms of, and does that relation
// close a loop?
//
// Three layers answer that question with the same shape but different edges, so
// the traversal lives here once. It deals in names and positions only: the
// diagnostics themselves are pushed by the typechecker, which is where every
// coded diagnostic belongs.
//
// The search is iterative. Recursion here would be the same defect the tile
// walk had — a program is free to declare a chain of definitions longer than
// the call stack, and a cycle checker that overflows on one is no better than
// the crash it exists to prevent.

import type { Expr, Pos, TileExpr } from "./ast.ts";
import { isTileExpr } from "./ast.ts";

/** An edge to another definition, positioned at the identifier that names it. */
export type GraphEdge = { readonly to: string; readonly pos: Pos };

export type Cycle = {
  /** The loop, entry node first and repeated last: `["A", "B", "A"]`. */
  readonly path: readonly string[];
  /** The first edge of the loop — inside the definition `path[0]` names. */
  readonly pos: Pos;
};

/**
 * The tile names a tile body statically expands into.
 *
 * These are exactly the edges code generation follows when it inlines: nested
 * tile calls, a bare identifier argument standing in for a tile, and the
 * branches of `for` / `when` / `if` / `match`. Names that turn out to denote a
 * builtin, or nothing at all, are included — the caller knows which table to
 * resolve them against, and code generation resolves a bare identifier to a
 * tile before anything else, so a slot of the same name is not the target.
 *
 * `sub-routes` and `error-boundary` are deliberately absent. Neither is
 * inlined: a sub-route is selected by the router through `route-outlet`, and a
 * boundary is applied where a tile is mounted as a route root, not to a tile
 * inlined as a child.
 */
export function expansionTargets(body: TileExpr): readonly GraphEdge[] {
  const out: GraphEdge[] = [];
  walk(body, out);
  return out;
}

function walk(t: TileExpr, out: GraphEdge[]): void {
  switch (t.kind) {
    case "TileFor":
    case "TileWhen":
      walk(t.body, out);
      return;
    case "TileIf":
      walk(t.consequent, out);
      walk(t.alternate, out);
      return;
    case "TileMatch":
      for (const arm of t.arms) walk(arm.body, out);
      return;
    case "TileCall": {
      out.push({ to: t.name, pos: t.pos });
      for (const a of t.args) {
        // A named argument is a prop, not a child — code generation skips it.
        if (a.name) continue;
        const v = a.value;
        if (isTileExpr(v)) walk(v, out);
        else if ((v as Expr).kind === "Ref") {
          const ref = v as Expr & { kind: "Ref" };
          out.push({ to: ref.name, pos: ref.pos });
        }
      }
      return;
    }
    default:
      return;
  }
}

/**
 * Every loop reachable from `nodes`, in the order the nodes are given.
 *
 * One loop is reported once however many definitions lead into it: a node the
 * search has finished with is never re-entered, so a second route to the same
 * loop finds nothing. Two loops that share no node are two reports.
 */
export function findCycles(
  nodes: Iterable<string>,
  edgesOf: (node: string) => readonly GraphEdge[],
): readonly Cycle[] {
  const cycles: Cycle[] = [];
  const finished = new Set<string>();

  for (const root of nodes) {
    if (finished.has(root)) continue;
    // `enteredBy` is the position of the edge that reached this node, which is
    // what a loop through it is reported at.
    const frames: { node: string; edges: readonly GraphEdge[]; next: number; enteredBy?: Pos }[] = [
      { node: root, edges: edgesOf(root), next: 0 },
    ];
    const depthOf = new Map<string, number>([[root, 0]]);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (!frame) break;
      const edge = frame.edges[frame.next];
      if (!edge) {
        finished.add(frame.node);
        depthOf.delete(frame.node);
        frames.pop();
        continue;
      }
      frame.next += 1;

      const depth = depthOf.get(edge.to);
      if (depth !== undefined) {
        const path = frames.slice(depth).map((f) => f.node);
        // The loop is reported at its first edge, so the message and the
        // position name the same definition. A self-loop has no second frame
        // to take that edge from — the back edge is the first edge.
        cycles.push({ path: [...path, edge.to], pos: frames[depth + 1]?.enteredBy ?? edge.pos });
        continue;
      }
      if (finished.has(edge.to)) continue;
      depthOf.set(edge.to, frames.length);
      frames.push({ node: edge.to, edges: edgesOf(edge.to), next: 0, enteredBy: edge.pos });
    }
  }
  return cycles;
}
