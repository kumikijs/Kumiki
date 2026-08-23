// Which definitions is a definition written in terms of, and does that relation
// close a loop?
//
// Three layers answer that question with the same shape but different edges, so
// the traversal lives here once. It deals in names and positions only: the
// diagnostics themselves are pushed by the typechecker, which is where every
// coded diagnostic belongs.
//
// The search over definitions is iterative. Recursion there would be the same
// defect the tile walk had — a program is free to declare a chain of
// definitions longer than the call stack, and a cycle checker that overflows on
// one is no better than the crash it exists to prevent. Walking a single tile
// body does recurse, which is safe for a different reason: a body is bounded by
// the parser's nesting limit, and nothing bounds the graph between definitions.

import type { Expr, Pos, TileDef, TileExpr } from "./ast.ts";
import { isTileExpr } from "./ast.ts";
import { HANDLER_NAMES } from "./ui-lifts.ts";

/** An edge to another definition, positioned at the identifier that names it. */
export type GraphEdge = { readonly to: string; readonly pos: Pos };

export type Cycle = {
  /**
   * The loop, entry node first and repeated last: `["A", "B", "A"]`.
   *
   * Non-empty by construction, and typed that way so a caller can name
   * `path[0]` without a check that would read as defensive. Reporting
   * `Tile "undefined" expands into itself` is the failure this rules out.
   */
  readonly path: readonly [string, ...string[]];
  /** The first edge of the loop — inside the definition `path[0]` names. */
  readonly pos: Pos;
};

/**
 * The tile names a tile body statically expands into.
 *
 * These are exactly the edges code generation follows when it inlines: nested
 * tile calls, an identifier argument standing in for a tile, and the branches
 * of `for` / `when` / `if` / `match`. Names that turn out to denote a builtin,
 * or nothing at all, are included — the caller knows which table to resolve
 * them against, and code generation resolves a bare identifier to a tile
 * before anything else, so a slot of the same name is not the target.
 *
 * A tile's own `error-boundary` is an edge too, but it belongs to the
 * definition rather than to its body — `boundaryTarget` is where it is taken
 * from. `sub-routes` is not an edge: a sub-route is selected by the router
 * through `route-outlet`, never inlined.
 */
export function expansionTargets(body: TileExpr): readonly GraphEdge[] {
  const out: GraphEdge[] = [];
  walkTileBody(body, out);
  return out;
}

/**
 * The tile a definition falls back to when its render throws, if it declares
 * one. Code generation inlines the boundary's body at every call site of the
 * tile that declares it, so it expands exactly like a child does.
 */
export function boundaryTarget(def: TileDef): GraphEdge | null {
  if (!def.errorBoundary) return null;
  return { to: def.errorBoundary, pos: def.errorBoundaryPos ?? def.pos };
}

function walkTileBody(t: TileExpr, out: GraphEdge[]): void {
  switch (t.kind) {
    case "TileFor":
    case "TileWhen":
      walkTileBody(t.body, out);
      return;
    case "TileIf":
      walkTileBody(t.consequent, out);
      walkTileBody(t.alternate, out);
      return;
    case "TileMatch":
      for (const arm of t.arms) walkTileBody(arm.body, out);
      return;
    case "TileCall": {
      out.push({ to: t.name, pos: t.pos });
      for (const a of t.args) {
        const v = a.value;
        // An event handler names a reducer, so it expands into nothing — and a
        // capitalised name in that position parses as a tile call, so without
        // this the handler looks like a child here. `onClick=App` inside `App`
        // then reported the tile as expanding into itself.
        //
        // This drops a tile-shaped value as well as a reference, which is only
        // safe because such a value is E0201: there is no expansion edge left
        // to keep. A handler value that the typechecker accepted as a tile
        // would be a child this search could no longer see.
        if (a.name !== undefined && HANDLER_NAMES.has(a.name)) continue;
        // A named argument is a prop rather than a child in a builtin
        // container — but a user tile takes its first argument by position or
        // by name alike, and inlines a tile-valued one. Following every
        // argument covers both; an argument that is not a tile contributes
        // nothing either way.
        if (isTileExpr(v)) walkTileBody(v, out);
        else if (a.name === undefined && (v as Expr).kind === "Ref") {
          const ref = v as Expr & { kind: "Ref" };
          out.push({ to: ref.name, pos: ref.pos });
        }
      }
      return;
    }
    default: {
      // A new `TileExpr` kind must be given its edges here rather than
      // silently having none — a kind that expands into children and is
      // missed is a cycle the search cannot see.
      const exhaustive: never = t;
      void exhaustive;
      return;
    }
  }
}

/**
 * Every loop reachable from `nodes`, in the order the nodes are given.
 *
 * One loop is reported once however many definitions lead into it, and once
 * however many edges close it. The first comes from never re-entering a node
 * the search has finished with; the second needs `reported`, because a body
 * may take the same back edge more than once — `column(A, A)` and
 * `if c then column(A) else column(A)` both do, and both are ordinary. Two
 * loops that share no node are two reports.
 */
export function findCycles(
  nodes: Iterable<string>,
  edgesOf: (node: string) => readonly GraphEdge[],
): readonly Cycle[] {
  const cycles: Cycle[] = [];
  const finished = new Set<string>();
  // Keyed by the loop itself rather than by its entry point: two loops through
  // one node (`A → B → A` and `A → C → A`) are two distinct findings.
  const reported = new Set<string>();

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
        const head = frames[depth];
        if (!head) continue;
        const path: [string, ...string[]] = [
          head.node,
          ...frames.slice(depth + 1).map((f) => f.node),
          edge.to,
        ];
        const key = path.join(" ");
        if (reported.has(key)) continue;
        reported.add(key);
        // The loop is reported at its first edge, so the message and the
        // position name the same definition. A self-loop has no second frame
        // to take that edge from — the back edge is the first edge.
        cycles.push({ path, pos: frames[depth + 1]?.enteredBy ?? edge.pos });
        continue;
      }
      if (finished.has(edge.to)) continue;
      depthOf.set(edge.to, frames.length);
      frames.push({ node: edge.to, edges: edgesOf(edge.to), next: 0, enteredBy: edge.pos });
    }
  }
  return cycles;
}
