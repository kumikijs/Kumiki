// Which definitions is a definition written in terms of, and does that relation
// close a loop?
//
// Four layers answer that question with the same shape but different edges, so
// the traversal lives here once. It deals in edges only — names and positions,
// and for a tile body the call each edge was taken at: the diagnostics
// themselves are pushed by the typechecker, which is where every coded
// diagnostic belongs.
//
// The search over definitions is iterative. Recursion there would be the same
// defect the tile walk had — a program is free to declare a chain of
// definitions longer than the call stack, and a cycle checker that overflows on
// one is no better than the crash it exists to prevent. Walking a single tile
// body does recurse, which is safe for a different reason: a body is bounded by
// the parser's nesting limit, and nothing bounds the graph between definitions.

import type { Expr, Pos, TileDef, TileExpr, TypeDef, TypeExpr } from "./ast.ts";
import { isTileExpr } from "./ast.ts";

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
 * An edge out of a tile body, with where in the body it was taken.
 *
 * `root` is whether the node it leads to is one the body renders at its top —
 * reached through `for` / `when` / `if` / `match` alone, not as a child of a
 * call. Those are the nodes a call site of the tile merges its props onto
 * (`_attachProps`). `call` is the tile call written there; an identifier
 * argument standing in for a tile has none.
 */
export type TileEdge = GraphEdge & {
  readonly root: boolean;
  readonly call?: TileExpr & { kind: "TileCall" };
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
export function expansionTargets(body: TileExpr): readonly TileEdge[] {
  const out: TileEdge[] = [];
  walkTileBody(body, out, true);
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

/**
 * Where a `type` body's alias chain goes next, before any definition is looked
 * up: a name it was written in terms of (with whatever arguments it was applied
 * to), one of the enclosing definition's own parameters, or `null` where
 * normalisation stops.
 */
type AliasHead =
  | {
      readonly kind: "name";
      readonly name: string;
      readonly pos: Pos;
      readonly args: readonly TypeExpr[];
    }
  | { readonly kind: "param"; readonly name: string };

/**
 * Whether a walk along a type's head looks through `nominal` (normalisation,
 * which strips it) or stops there (the search for a nominal declaration, for
 * which the wrapper is the answer).
 */
export type NominalReading = "through" | "stop";

/**
 * The head of a type expression — what `unaliasType` would look at next.
 *
 * `nominal` and `where` are passed through: neither is a type of its own, so
 * normalisation strips them and carries on to the name underneath. A reading
 * of `"stop"` ends the head at `nominal` instead. A record, a
 * union and a primitive are types in their own right and stop it, so they
 * answer `null` and nothing written inside one is ever reached.
 *
 * A parameter *applied* to arguments answers `null` rather than a head:
 * `unaliasType` carries no parameter scope, so it would resolve such a name
 * against the global table, and the one-sided reading prefers a chain that
 * stops early over an edge that may be to the wrong definition.
 */
function headOf(
  t: TypeExpr,
  params: ReadonlySet<string>,
  nominal: NominalReading = "through",
): AliasHead | null {
  let cur = t;
  for (;;) {
    switch (cur.kind) {
      case "TypeNominal":
        if (nominal === "stop") return null;
        cur = cur.inner;
        continue;
      case "TypeRefinement":
        cur = cur.inner;
        continue;
      case "TypeRef":
        return params.has(cur.name)
          ? { kind: "param", name: cur.name }
          : { kind: "name", name: cur.name, pos: cur.pos, args: [] };
      case "TypeApp":
        return params.has(cur.name)
          ? null
          : { kind: "name", name: cur.name, pos: cur.pos, args: cur.args };
      case "TypePrim":
      case "TypeRecord":
      case "TypeUnion":
        return null;
      default: {
        // A new `TypeExpr` kind must be classified here rather than silently
        // ending the chain — one that wraps another type and is missed is a
        // cycle the search cannot see, exactly as in `walkTileBody`.
        const exhaustive: never = cur;
        void exhaustive;
        return null;
      }
    }
  }
}

/**
 * The parameter a generic hands straight back — the index `i` for which
 * normalising `D(a₁ … aₙ)` is normalising `aᵢ` — or `null` when `D` has a type
 * of its own to contribute.
 *
 * `type Alias(T) = T` is the shape, and `type Tag(T) = nominal T` and
 * `type Pos(T) = T where positive` are the same shape under wrappers, since
 * neither wrapper is a type of its own. It is transitive, through the head and
 * through the argument the head hands back: `type Outer(T) = Alias(T)` hands
 * back its parameter by way of `Alias`, and so does `type Twice(T) =
 * Alias(Alias(T))`, by way of `Alias` twice.
 *
 * `nominal` decides whether the wrapper is looked through. Normalisation
 * strips it (`"through"`); the search for a nominal declaration stops at it
 * (`"stop"`), because there the wrapper *is* the answer.
 *
 * Two readers share it. `aliasTarget` follows a chain on through such a
 * generic's argument, since that is where normalisation goes next — otherwise
 * `type A = Alias(A)` has no edge and the loop is invisible.
 * `assignable.ts#unaliasType` and `nominalDecl` take the step in one move
 * rather than expanding the body: normalising `Twice(X)` by expansion walks
 * `Alias` twice, and a chain of definitions that each apply the one below
 * twice doubles that at every level.
 *
 * Returns the classifier rather than one answer so the answers are shared: a
 * definition is classified once however many heads name it, which is what
 * keeps the doubling chain linear here too. Iterative for the reason the
 * module docblock gives — the walk is between definitions, and nothing bounds
 * how many of them a program may chain. A generic whose head comes back to a
 * definition still being classified (`type Loop(T) = Loop(T)`, or two that
 * forward to each other) has no parameter to hand back.
 */
export function forwardedParams(
  lookup: (name: string) => TypeDef | undefined,
  nominal: NominalReading,
): (def: TypeDef) => number | null {
  const answers = new Map<string, number | null>();
  // Where `expr`, written inside a definition with `params`, ends up: one of
  // those parameters by index, `null` for somewhere else, or the definition
  // that has to be classified before this can be told.
  const follow = (expr: TypeExpr, params: readonly string[]): number | null | TypeDef => {
    const scope = new Set(params);
    let cur = expr;
    for (;;) {
      const head = headOf(cur, scope, nominal);
      if (!head) return null;
      if (head.kind === "param") return params.indexOf(head.name);
      const def = lookup(head.name);
      if (!def) return null;
      if (!answers.has(def.name)) return def;
      const i = answers.get(def.name);
      if (i === null || i === undefined) return null;
      // A generic named with too few arguments is E0210's to report; there is
      // no argument here to carry on with.
      const arg = head.args[i];
      if (!arg) return null;
      cur = arg;
    }
  };
  return (root) => {
    // Asked again for every application a walk meets, so an answer already
    // held is read without setting up the walk.
    if (answers.has(root.name)) return answers.get(root.name) ?? null;
    const stack: TypeDef[] = [root];
    const open = new Set<string>([root.name]);
    while (stack.length > 0) {
      const def = stack[stack.length - 1];
      if (!def) break;
      const next = answers.has(def.name) ? answers.get(def.name) : follow(def.body, def.params);
      if (typeof next === "object" && next !== null) {
        if (!open.has(next.name)) {
          stack.push(next);
          open.add(next.name);
          continue;
        }
        answers.set(def.name, null);
      } else {
        answers.set(def.name, next ?? null);
      }
      stack.pop();
      open.delete(def.name);
    }
    return answers.get(root.name) ?? null;
  };
}

/**
 * The definition a `type` is written in terms of — the edge
 * `assignable.ts#unaliasType` takes when it normalises the body — or `null`
 * when the body is a type of its own, or is one of the definition's parameters
 * and so has no meaning until a call site supplies one.
 *
 * An alias (`type A = B`), and a `nominal` / `where` wrapper around one, has no
 * meaning until the definition it names is reached. A record, a union, a
 * primitive and a container are types in their own right, so no name written
 * *inside* one is an edge: `type Node = {value: Int, next: Node}` reaches a
 * record before it reaches itself, and stays legal — comparing two of them
 * terminates because `relate` keys on the types **as written**, which is finite
 * whether or not the values are. That is also why there is at most one edge: an
 * alias chain has one successor, unlike a tile body, which expands into every
 * child it names.
 *
 * A `TypeApp` is an alias step like a bare name is, since `unaliasType`
 * instantiates and keeps going. Its **arguments are followed too**, but only
 * where normalisation follows them — through a generic that hands a parameter
 * straight back (`forwardedParams`), which is the one case where substitution
 * decides what comes next. So `type Alias(T) = T` / `type A = Alias(A)` closes
 * a loop, while `type A = Alias(Option(A))` does not: the argument is a
 * container, and a container is where normalisation stops.
 *
 * `lookup` resolves a name against the `type` definitions in scope. A name it
 * does not answer for is returned as the edge unchanged — the caller knows
 * which table to filter against, as for tiles.
 *
 * The hop loop needs no guard of its own: each hop moves to a head strictly
 * inside the arguments of the previous one, so it is bounded by the body's
 * nesting depth, which the parser bounds.
 */
export function aliasTarget(
  def: TypeDef,
  lookup: (name: string) => TypeDef | undefined,
): GraphEdge | null {
  const params = new Set(def.params);
  const forwarded = forwardedParams(lookup, "through");
  let head = headOf(def.body, params);
  while (head?.kind === "name") {
    const edge = { to: head.name, pos: head.pos };
    const target = lookup(head.name);
    if (!target) return edge;
    const i = forwarded(target);
    if (i === null) return edge;
    const arg = head.args[i];
    // A generic named with too few arguments is E0210's to report; there is no
    // argument here to carry the chain on, so it ends at the generic.
    if (!arg) return edge;
    head = headOf(arg, params);
  }
  return null;
}

function walkTileBody(t: TileExpr, out: TileEdge[], root: boolean): void {
  switch (t.kind) {
    case "TileFor":
    case "TileWhen":
      walkTileBody(t.body, out, root);
      return;
    case "TileIf":
      walkTileBody(t.consequent, out, root);
      walkTileBody(t.alternate, out, root);
      return;
    case "TileMatch":
      for (const arm of t.arms) walkTileBody(arm.body, out, root);
      return;
    case "TileCall": {
      out.push({ to: t.name, pos: t.pos, root, call: t });
      for (const a of t.args) {
        const v = a.value;
        // A named argument is a prop, and nothing renders a tile written as
        // one: a builtin container skips named arguments, the builtins that
        // read one by name all want a value, and a user tile takes its input
        // from the positional argument. So there is no expansion edge here —
        // and for a named argument that is not a handler, the shape is
        // reported anyway, as E0201 on a user tile.
        //
        // An event handler is the same case with a second reason: it names a
        // reducer, and a capitalised name in that position parses as a tile
        // call, so `onClick=App` inside `App` reported the tile as expanding
        // into itself. Since the handler position resolves in the reducer
        // namespace, such a name is either a reducer (no diagnostic) or an
        // undefined one (E0102) — never an expansion edge either way, which
        // is why this `continue` needs no case of its own.
        if (a.name !== undefined) continue;
        if (isTileExpr(v)) walkTileBody(v, out, false);
        else if ((v as Expr).kind === "Ref") {
          const ref = v as Expr & { kind: "Ref" };
          out.push({ to: ref.name, pos: ref.pos, root: false });
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
