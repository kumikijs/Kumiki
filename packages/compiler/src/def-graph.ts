import type { Expr, Pos, TileDef, TileExpr, TypeDef, TypeExpr } from "./ast.ts";
import { isTileExpr } from "./ast.ts";

/** An edge to another definition, positioned at the identifier that names it. */
export type GraphEdge = { readonly to: string; readonly pos: Pos };

export type Cycle = {
  readonly path: readonly [string, ...string[]];
  /** The first edge of the loop — inside the definition `path[0]` names. */
  readonly pos: Pos;
};

export function expansionTargets(body: TileExpr): readonly GraphEdge[] {
  const out: GraphEdge[] = [];
  walkTileBody(body, out);
  return out;
}

export function boundaryTarget(def: TileDef): GraphEdge | null {
  if (!def.errorBoundary) return null;
  return { to: def.errorBoundary, pos: def.errorBoundaryPos ?? def.pos };
}

type AliasHead =
  | {
      readonly kind: "name";
      readonly name: string;
      readonly pos: Pos;
      readonly args: readonly TypeExpr[];
    }
  | { readonly kind: "param"; readonly name: string };

export type NominalReading = "through" | "stop";

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
        const exhaustive: never = cur;
        void exhaustive;
        return null;
      }
    }
  }
}

export function forwardedParams(
  lookup: (name: string) => TypeDef | undefined,
  nominal: NominalReading,
): (def: TypeDef) => number | null {
  const answers = new Map<string, number | null>();
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
      const arg = head.args[i];
      if (!arg) return null;
      cur = arg;
    }
  };
  return (root) => {
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
    if (!arg) return edge;
    head = headOf(arg, params);
  }
  return null;
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
        if (a.name !== undefined) continue;
        if (isTileExpr(v)) walkTileBody(v, out);
        else if ((v as Expr).kind === "Ref") {
          const ref = v as Expr & { kind: "Ref" };
          out.push({ to: ref.name, pos: ref.pos });
        }
      }
      return;
    }
    default: {
      const exhaustive: never = t;
      void exhaustive;
      return;
    }
  }
}

export function findCycles(
  nodes: Iterable<string>,
  edgesOf: (node: string) => readonly GraphEdge[],
): readonly Cycle[] {
  const cycles: Cycle[] = [];
  const finished = new Set<string>();
  const reported = new Set<string>();

  for (const root of nodes) {
    if (finished.has(root)) continue;
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
