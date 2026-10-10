import { assignable, typeToString } from "../assignable.ts";
import {
  type Expr,
  isTileExpr,
  type Pos,
  type TileDef,
  type TileExpr,
  type TypeExpr,
} from "../ast.ts";
import { BUILTIN_TILES, contentReading, positionalIsTile } from "../builtins.ts";
import { HANDLER_NAMES, HANDLER_PROP_TILES, handlerReducerName } from "../ui-lifts.ts";
import { duplicateSubRoutes } from "../uniqueness.ts";
import { checkAgainst } from "./against.ts";
import {
  checkBindStrictProp,
  checkBindTargetSteps,
  checkInputBindType,
  checkToggleBind,
} from "./bind.ts";
import { bindLocal, type Ctx, innerScope, type KumikiError, type SymbolTable } from "./context.ts";
import { checkCondition, checkExpr, checkIterationTarget, elementTypeOf } from "./expr.ts";
import { inferType } from "./infer.ts";
import { checkPatternAgainstType, checkPatternBindsAreDistinct } from "./patterns.ts";
import { checkA11y, checkButtonType, checkIconName } from "./tile-props.ts";
import { resolveType } from "./types.ts";

export function checkTile(tile: TileDef, sym: SymbolTable, errors: KumikiError[]): void {
  const ctx: Ctx = {
    kind: "tile",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
  };
  if (tile.in) {
    resolveType(tile.in, sym, errors);
    ctx.localBinds.add("$1");
    ctx.localTypes.set("$1", tile.in);
  }
  checkTileExpr(tile.body, sym, errors, ctx);
  if (tile.errorBoundary !== undefined && !sym.tiles.has(tile.errorBoundary)) {
    errors.push({
      code: "E0105",
      kind: "undef-tile",
      message: `Tile "${tile.name}" declares error-boundary "${tile.errorBoundary}", which is not a tile`,
      pos: tile.errorBoundaryPos ?? tile.pos,
    });
  }
  checkBoundaryFallback(tile, sym, errors);
  if (tile.subRoutes) checkSubRoutes(tile, sym, errors);
}

function checkBoundaryFallback(tile: TileDef, sym: SymbolTable, errors: KumikiError[]): void {
  if (tile.errorBoundary === undefined) return;
  const fallback = sym.tiles.get(tile.errorBoundary);
  if (fallback === undefined) return; // E0105
  let declared: string;
  if (fallback.in === undefined) {
    if (!readsUndeclaredInput(fallback, sym)) return;
    declared = "declares no in= but reads $1";
  } else {
    const panicInfo: TypeExpr = { kind: "TypeRef", name: "PanicInfo", pos: fallback.pos };
    if (assignable(panicInfo, fallback.in, sym)) return;
    declared = `declares in=${typeToString(fallback.in)}`;
  }
  errors.push({
    code: "E0220",
    kind: "boundary-fallback-input",
    message:
      `Tile "${tile.name}" uses "${fallback.name}" as its error-boundary, which ${declared} — ` +
      `a fallback is applied to the panic, so it receives a PanicInfo as $1 and must declare ` +
      `in=PanicInfo`,
    pos: tile.errorBoundaryPos ?? tile.pos,
  });
}

function readsUndeclaredInput(tile: TileDef, sym: SymbolTable): boolean {
  const seen: Pos[] = [];
  const ctx: Ctx = {
    kind: "tile",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
    undeclaredInputReads: seen,
  };
  checkTileExpr(tile.body, sym, [], ctx);
  return seen.length > 0;
}

export function checkRouteTargetArity(
  entry: { path: string; tile: string; tilePos?: Pos; pathPos: Pos },
  where: string,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  const target = sym.tiles.get(entry.tile);
  if (!target?.in) return;
  errors.push({
    code: "E0213",
    kind: "call-arity-mismatch",
    message: `${where} targets tile "${entry.tile}", which expects 1 argument(s) — a route target is rendered with none`,
    pos: entry.tilePos ?? entry.pathPos,
  });
}

function checkSubRoutes(tile: TileDef, sym: SymbolTable, errors: KumikiError[]): void {
  const subRoutes = tile.subRoutes;
  if (!subRoutes) return;
  for (const sr of subRoutes) {
    if (sr.tile.startsWith(">>")) continue; // a redirect names a path, not a tile
    const where = `Sub-route "${sr.path}" in tile "${tile.name}"`;
    if (!sym.tiles.has(sr.tile)) {
      errors.push({
        code: "E0105",
        kind: "undef-tile",
        message: `${where} targets undefined tile "${sr.tile}"`,
        pos: tile.pos,
      });
    }
    checkRouteTargetArity(sr, where, sym, errors);
  }
  for (const dup of duplicateSubRoutes(subRoutes)) {
    errors.push({
      code: "E0112",
      kind: "duplicate-sub-route",
      message: `Sub-route path "${dup.name}" is declared more than once in tile "${tile.name}"`,
      pos: dup.pos,
    });
  }
  const app = sym.app;
  if (!app) return;
  const parents = app.routes.filter((r) => !r.tile.startsWith(">>") && r.tile === tile.name);
  if (parents.length === 0) {
    errors.push({
      code: "E0111",
      kind: "orphan-sub-routes",
      message: `Tile "${tile.name}" declares sub-routes but is not the target of any route in app.routes`,
      pos: tile.pos,
    });
    return;
  }
  for (const parent of parents) {
    if (!parent.path.endsWith("/*")) {
      errors.push({
        code: "E0114",
        kind: "sub-routes-without-wildcard-parent",
        message: `Tile "${tile.name}" declares sub-routes but its parent route "${parent.path}" is not a wildcard pattern (must end with "/*")`,
        pos: tile.pos,
      });
    }
  }
  if (!tileBodyUsesRouteOutlet(tile.body)) {
    errors.push({
      code: "E0113",
      kind: "sub-routes-without-outlet",
      message: `Tile "${tile.name}" declares sub-routes but its body never calls "route-outlet" — the matched child would have nowhere to render`,
      pos: tile.pos,
    });
  }
}

/** True if any sub-tree of the tile body is a `route-outlet` call. */
function tileBodyUsesRouteOutlet(t: TileExpr): boolean {
  switch (t.kind) {
    case "TileCall": {
      if (t.name === "route-outlet") return true;
      for (const arg of t.args) {
        const v = arg.value as TileExpr;
        if (
          v.kind === "TileCall" ||
          v.kind === "TileFor" ||
          v.kind === "TileWhen" ||
          v.kind === "TileIf" ||
          v.kind === "TileMatch"
        ) {
          if (tileBodyUsesRouteOutlet(v)) return true;
        }
      }
      return false;
    }
    case "TileFor":
    case "TileWhen":
      return tileBodyUsesRouteOutlet(t.body);
    case "TileIf":
      return tileBodyUsesRouteOutlet(t.consequent) || tileBodyUsesRouteOutlet(t.alternate);
    case "TileMatch":
      return t.arms.some((arm) => tileBodyUsesRouteOutlet(arm.body));
  }
}

export function checkTileExpr(
  t: TileExpr,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  switch (t.kind) {
    case "TileFor": {
      checkExpr(t.iter, sym, errors, ctx);
      checkIterationTarget(t.iter, sym, errors, ctx);
      const inner = innerScope(ctx);
      bindLocal(inner, t.bind, elementTypeOf(t.iter, sym, ctx));
      checkTileExpr(t.body, sym, errors, inner);
      return;
    }
    case "TileWhen":
      checkExpr(t.cond, sym, errors, ctx);
      checkCondition(t.cond, inferType(t.cond, sym, ctx), sym, errors, '"when"');
      checkTileExpr(t.body, sym, errors, ctx);
      return;
    case "TileIf":
      checkExpr(t.cond, sym, errors, ctx);
      checkCondition(t.cond, inferType(t.cond, sym, ctx), sym, errors, '"if"');
      checkTileExpr(t.consequent, sym, errors, ctx);
      checkTileExpr(t.alternate, sym, errors, ctx);
      return;
    case "TileMatch": {
      checkExpr(t.scrutinee, sym, errors, ctx);
      const scrutType = inferType(t.scrutinee, sym, ctx);
      for (const arm of t.arms) {
        const inner = innerScope(ctx);
        checkPatternBindsAreDistinct(arm.pattern, errors);
        checkPatternAgainstType(arm.pattern, scrutType, sym, errors, inner);
        checkTileExpr(arm.body, sym, errors, inner);
      }
      return;
    }
    case "TileCall":
      checkTileCall(t, sym, errors, ctx);
      return;
  }
}

function checkTileInput(
  t: TileExpr & { kind: "TileCall" },
  def: TileDef,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const positional = t.args.filter((a) => a.name === undefined);
  const wants = def.in ? 1 : 0;
  if (positional.length !== wants) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Tile "${t.name}" expects ${wants} argument(s) but got ${positional.length}`,
      pos: t.pos,
    });
    return;
  }
  for (const named of t.args) {
    if (named.name === undefined || !isTileExpr(named.value)) continue;
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message:
        `Named argument "${named.name}" on tile "${t.name}" is a prop, and a prop's value ` +
        `cannot be a tile — nothing renders it. Pass the tile as the positional argument of ` +
        `a tile that declares "in=", or write it as a child`,
      pos: named.value.pos,
    });
  }
  const arg = positional[0];
  if (!def.in || !arg) return;
  const value = arg.value;
  if (isTileExpr(value)) {
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message: `Tile "${t.name}" expects a value of type ${typeToString(def.in)} but got a tile`,
      pos: value.pos,
    });
    return;
  }
  checkAgainst(value, def.in, sym, errors, ctx);
}

function checkContentArgs(t: TileExpr & { kind: "TileCall" }, errors: KumikiError[]): void {
  const reading = contentReading(t.name);
  if (!reading) return;
  const positional = t.args.filter((a) => a.name === undefined);
  const read = reading.positional ? 1 : 0;
  positional.slice(read).forEach((a, i) => {
    errors.push({
      code: "E0129",
      kind: "unrendered-arg",
      message: reading.positional
        ? `${t.name} renders its first positional argument only — positional argument ` +
          `${i + read + 1} is never rendered. Join the values (\`a + b\`, \`fmt(…)\`) or give ` +
          `each its own ${t.name}`
        : `${t.name} takes its ${reading.named} as \`${reading.named}=\` — a positional ` +
          `argument is never rendered. Write \`${t.name}(${reading.named}=…)\``,
      pos: a.value.pos,
      unrendered: "positional",
    });
  });
  if (!reading.positional) return;
  const named = t.args.find((a) => a.name === "text");
  if (!named?.name) return;
  if (reading.named === "text" && positional.length > 0) {
    errors.push({
      code: "E0129",
      kind: "unrendered-arg",
      message:
        `${t.name} renders its positional argument, so \`text=\` is never rendered — it is ` +
        `read only when no positional argument is written. Remove \`text=\` or the ` +
        `positional argument`,
      pos: named.namePos,
      unrendered: "text-shadowed",
    });
    return;
  }
  if (reading.named !== undefined || positional.length > 0) return;
  errors.push({
    code: "E0129",
    kind: "unrendered-arg",
    message:
      `content is positional: write \`${t.name}("…")\` — \`text=\` is a prop on ${t.name} ` +
      `and never renders (it is the label argument of button, link, label and editable)`,
    pos: named.namePos,
    unrendered: "text-prop",
  });
}

function checkTileCall(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const userTile = sym.tiles.get(t.name);
  if (!BUILTIN_TILES.has(t.name) && !userTile) {
    errors.push({
      code: "E0105",
      kind: "undef-tile",
      message: `Reference to undefined tile "${t.name}"`,
      pos: t.pos,
    });
  }
  if (userTile) checkTileInput(t, userTile, sym, errors, ctx);
  checkA11y(t, sym, errors);
  checkContentArgs(t, errors);
  checkIconName(t, sym, errors);
  checkButtonType(t, errors);
  checkBindStrictProp(t, errors);
  checkBindTargetSteps(t, errors);
  checkToggleBind(t, sym, errors, ctx);
  checkInputBindType(t, sym, errors, ctx);
  if (t.name === "input") {
    const bindArg = t.args.find((a) => a.name === "bind");
    const typeArg = t.args.find((a) => a.name === "type");
    const typeVal = typeArg?.value as Expr | undefined;
    const isFileType = typeVal?.kind === "Str" && typeVal.value === "file";
    if (bindArg && isFileType) {
      const bindVal = bindArg.value as Expr;
      const slotName = bindVal.kind === "Ref" ? bindVal.name : "<expr>";
      errors.push({
        code: "E0205",
        kind: "bind-on-file-input",
        message: `input(type="file") does not support bind="${slotName}"; receive files via a ui.change reducer with $event.files.head (see docs/spec/forms.md)`,
        pos: bindVal.pos,
      });
    }
    const isKnownNonFile =
      typeVal === undefined || (typeVal.kind === "Str" && typeVal.value !== "file");
    if (isKnownNonFile) {
      const observedType =
        typeVal === undefined
          ? `no type, defaults to "text"`
          : `type="${(typeVal as Expr & { kind: "Str" }).value}"`;
      for (const arg of t.args) {
        if (arg.name !== "accept" && arg.name !== "multiple") continue;
        const argVal = arg.value as Expr;
        errors.push({
          code: "E0206",
          kind: "file-only-prop",
          message: `input prop "${arg.name}" requires type="file" (got ${observedType}); accept/multiple are only valid on file inputs (see docs/spec/forms.md)`,
          pos: argVal.pos,
        });
      }
    }
  }

  for (const arg of t.args) {
    const v = arg.value;
    if (arg.name !== undefined && HANDLER_NAMES.has(arg.name)) {
      checkHandlerBinding(t.name, arg.name, "arg", v, sym, errors);
      continue;
    }
    if (isTileExpr(v)) {
      checkTileExpr(v, sym, errors, ctx);
      continue;
    }
    if (
      arg.name === undefined &&
      positionalIsTile(t.name) &&
      !(v.kind === "Ref" && sym.tiles.has(v.name))
    ) {
      errors.push({
        code: "E0128",
        kind: "value-as-child",
        message:
          `A value is not a tile: ${t.name} renders a positional argument only when it is a ` +
          "tile, so this one renders nothing. Show the value with a tile — `text(…)` — or, " +
          "for a `let`, write the value where it is used or compute it in a `fn`",
        pos: v.pos,
      });
      continue;
    }
    checkExpr(v, sym, errors, ctx);
  }
  for (const prop of t.props) {
    if (HANDLER_NAMES.has(prop.name)) {
      checkHandlerBinding(t.name, prop.name, "prop", prop.value, sym, errors);
    } else if (prop.name === "motion" && prop.value.kind === "Str") {
      if (!sym.motions.has(prop.value.value)) {
        errors.push({
          code: "E0107",
          kind: "undef-motion",
          message: `Reference to undefined motion "${prop.value.value}"`,
          pos: prop.value.pos,
        });
      }
    } else if (t.name === "link" && prop.name === "prefetch") {
      const ref = prop.value;
      const name = ref.kind === "Ref" ? ref.name : ref.kind === "Str" ? ref.value : null;
      if (name === null) {
        errors.push({
          code: "E0201",
          kind: "type-mismatch",
          message: `link prefetch must be a reducer name`,
          pos: ref.pos,
        });
      } else if (!sym.reducers.has(name)) {
        errors.push({
          code: "E0102",
          kind: "undef-reducer",
          message: `Reference to undefined reducer "${name}"`,
          pos: ref.pos,
        });
      }
    } else {
      checkExpr(prop.value, sym, errors, ctx);
    }
  }
}

function checkHandlerBinding(
  tileName: string,
  handler: string,
  form: "arg" | "prop",
  value: Expr | TileExpr,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  checkHandlerTarget(tileName, handler, value.pos, sym, errors);
  const name = handlerReducerName(value);
  if (name === null) {
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message: `Event handler ${form} "${handler}" must be a reducer name`,
      pos: value.pos,
    });
    return;
  }
  if (!sym.reducers.has(name)) {
    errors.push({
      code: "E0102",
      kind: "undef-reducer",
      message: `Reference to undefined reducer "${name}"`,
      pos: value.pos,
    });
  }
}

function checkHandlerTarget(
  tileName: string,
  handler: string,
  pos: Pos,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  const allowed = HANDLER_PROP_TILES[handler];
  if (allowed == null) return;
  if (BUILTIN_TILES.has(tileName)) {
    if (allowed.has(tileName)) return;
    errors.push(inertHandler(tileName, handler, `${tileName} does not fire it`, allowed, pos));
    return;
  }
  if (!sym.tiles.has(tileName)) return;
  const kinds = sym.builtinKindsIn(tileName);
  if (kinds.size === 0) return;
  if ([...kinds].some((k) => allowed.has(k))) return;
  errors.push(
    inertHandler(
      tileName,
      handler,
      `${tileName} renders nothing that fires it (observed in body: ${[...kinds].sort().join(", ")})`,
      allowed,
      pos,
    ),
  );
}

/** One W0213, whichever side — builtin or user tile — asked for it. */
function inertHandler(
  tileName: string,
  handler: string,
  because: string,
  allowed: ReadonlySet<string>,
  pos: Pos,
): KumikiError {
  return {
    code: "W0213",
    kind: "handler-on-inert-tile",
    severity: "warning",
    message: `"${handler}" on ${tileName}() is dropped — ${because}. Put it on ${[...allowed].sort().join(" / ")}, or subscribe with a reducer's on=ui.<event>(<Tile>)`,
    pos,
  };
}
