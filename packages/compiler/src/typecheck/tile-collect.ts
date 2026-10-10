import {
  assertNever,
  type Expr,
  isTileExpr,
  type ReducerDef,
  type TileDef,
  type TileExpr,
} from "../ast.ts";
import { BUILTIN_TILES } from "../builtins.ts";
import { expansionTargets, reachedFrom } from "../def-graph.ts";
import type { SymbolTable } from "./context.ts";

// Answers are kept, so a tile is walked once however many positions ask about it, and the walk is
// iterative because nothing bounds how long a program may chain tiles.
export function collectTileBuiltinKinds(
  tiles: ReadonlyMap<string, TileDef>,
): (tileName: string) => ReadonlySet<string> {
  return reachedFrom(
    (name) => {
      if (BUILTIN_TILES.has(name)) return [];
      const def = tiles.get(name);
      return def ? expansionTargets(def.body) : [];
    },
    (name) => (BUILTIN_TILES.has(name) ? [name] : []),
  );
}

type TileIdCollection =
  | { readonly known: true; readonly ids: ReadonlySet<string> }
  | { readonly known: false };

const ID_COLL_UNKNOWN: TileIdCollection = Object.freeze({ known: false });

function mergeIdCollections(a: TileIdCollection, b: TileIdCollection): TileIdCollection {
  if (!a.known || !b.known) return ID_COLL_UNKNOWN;
  const out = new Set(a.ids);
  for (const v of b.ids) out.add(v);
  return { known: true, ids: out };
}

export function collectTileDeclaredIds(def: TileDef): TileIdCollection {
  return walkTileExprForDeclaredIds(def.body);
}

function walkTileExprForDeclaredIds(expr: TileExpr): TileIdCollection {
  switch (expr.kind) {
    case "TileFor":
    case "TileWhen":
      return walkTileExprForDeclaredIds(expr.body);
    case "TileIf":
      return mergeIdCollections(
        walkTileExprForDeclaredIds(expr.consequent),
        walkTileExprForDeclaredIds(expr.alternate),
      );
    case "TileMatch": {
      let acc: TileIdCollection = ID_COLL_UNKNOWN;
      for (let i = 0; i < expr.arms.length; i++) {
        const armIds = walkTileExprForDeclaredIds(expr.arms[i]!.body);
        acc = i === 0 ? armIds : mergeIdCollections(acc, armIds);
      }
      return acc;
    }
    case "TileCall": {
      const id = expr.props.find((p) => p.name === "id")?.value;
      if (id?.kind !== "Str") return ID_COLL_UNKNOWN;
      return { known: true, ids: new Set([id.value]) };
    }
    default: {
      const _exhaustive: never = expr;
      return _exhaustive;
    }
  }
}

export function bindsRoute(r: ReducerDef, sym: SymbolTable): boolean {
  if (r.on.kind === "LifecycleEvent" && r.on.name.startsWith("route.")) return true;
  return sym.prefetchTargets.has(r.name);
}

export function collectPrefetchTargets(expr: TileExpr, out: Set<string>): void {
  switch (expr.kind) {
    case "TileFor":
    case "TileWhen":
      collectPrefetchTargets(expr.body, out);
      return;
    case "TileIf":
      collectPrefetchTargets(expr.consequent, out);
      collectPrefetchTargets(expr.alternate, out);
      return;
    case "TileMatch":
      for (const arm of expr.arms) collectPrefetchTargets(arm.body, out);
      return;
    case "TileCall": {
      if (expr.name === "link") {
        const v = expr.props.find((p) => p.name === "prefetch")?.value;
        if (v?.kind === "Ref") out.add(v.name);
        else if (v?.kind === "Str") out.add(v.value);
      }
      for (const a of expr.args) if (isTileExpr(a.value)) collectPrefetchTargets(a.value, out);
      return;
    }
    default:
      assertNever(expr);
  }
}

export function writtenValue(t: TileExpr & { kind: "TileCall" }, name: string): Expr | undefined {
  const fromProp = t.props.find((p) => p.name === name)?.value;
  if (fromProp !== undefined) return fromProp;
  const fromArg = t.args.find((a) => a.name === name)?.value;
  return fromArg === undefined || isTileExpr(fromArg) ? undefined : fromArg;
}

export function collectElementIds(expr: TileExpr, out: Set<string>): void {
  switch (expr.kind) {
    case "TileFor":
    case "TileWhen":
      collectElementIds(expr.body, out);
      return;
    case "TileIf":
      collectElementIds(expr.consequent, out);
      collectElementIds(expr.alternate, out);
      return;
    case "TileMatch":
      for (const arm of expr.arms) collectElementIds(arm.body, out);
      return;
    case "TileCall": {
      const id = writtenValue(expr, "id");
      if (id?.kind === "Str") out.add(id.value);
      for (const a of expr.args) if (isTileExpr(a.value)) collectElementIds(a.value, out);
      return;
    }
    default:
      assertNever(expr);
  }
}
