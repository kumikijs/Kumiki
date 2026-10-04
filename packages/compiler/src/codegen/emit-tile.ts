import { unaliasType } from "../assignable.ts";
import type { Expr, TileArg, TileDef, TileExpr, TypeExpr } from "../ast.ts";
import { isTileExpr } from "../ast.ts";
import { bindTarget } from "../bind-target.ts";
import { BUILTIN_TILES, contentArg } from "../builtins.ts";
import { TIME_INPUT_PATTERNS } from "../input-bind.ts";
import type { ParseReading } from "../parse-reading.ts";
import {
  addBind,
  bindRef,
  childCtx,
  declareBind,
  type EnclosingTiles,
  type EvalCtx,
  type GenCtx,
  makeEvalCtx,
} from "./context.ts";
import { jsOfExpr, readingJs, tupleArm } from "./expr.ts";
import type { BindSegment } from "./path-segment.ts";
import { explicitHandlers, type HandlerWiring, keyFor, propsFor } from "./selector.ts";

export function genTile(tile: TileDef, gen: GenCtx): string {
  const ctx = makeEvalCtx(gen, new Set(tile.in ? ["$1"] : []));
  return tileExprJs(tile.body, gen, ctx, [tile.name]);
}

/**
 * The chain `name`'s body renders under. A name already in the chain is not
 * appended again — a tile reached twice on one path (a self-referencing body,
 * which `E0005` reports separately) would otherwise grow it without bound, and
 * a repeated name answers no selector the first occurrence does not.
 */
function under(chain: EnclosingTiles | undefined, name: string): EnclosingTiles {
  const outer = chain ?? [];
  return outer.includes(name) ? outer : [...outer, name];
}

/**
 * The `try` / `catch` a tile's `error-boundary` lowers to — a panic while
 * rendering under `def` produces the named fallback instead, with `PanicInfo`
 * as its `$1` (lifecycle.md §7.3). What counts as a panic, and what is re-thrown
 * rather than caught, is `_s.boundaryPanic`'s decision.
 *
 * Two things about the shape, both consequences rather than choices:
 *
 * - It wraps `body` from the outside, so the *panicking* tile's marker is
 *   discarded along with the tree it was on. What the runtime diffs
 *   mount / unmount against is the tree that actually rendered.
 * - The fallback is lowered here, not through a call site, so it carries no
 *   marker of its own either: `tile.mount(<the fallback>)` never fires.
 *
 * `enclosingTiles` is the chain the PANICKING tile's call site sits in, and
 * `def` is deliberately not on it. The fallback renders where `def`'s tree
 * would have been, so a selector on anything `def` was rendered under still
 * reaches it — that is the §1.6.2 rule that the reach is decided by the path.
 * `def` itself is the one name that does not carry over: its tree, and the
 * `_named(…, def)` marker with it, is what was discarded.
 */
function boundaryJs(
  def: TileDef,
  body: string,
  gen: GenCtx,
  enclosingTiles?: EnclosingTiles,
): string {
  if (!def.errorBoundary) return body;
  const fb = gen.tiles.find((x) => x.name === def.errorBoundary);
  // Unreachable: E0105 refuses a boundary that names no tile. It used to
  // return `body`, which compiled a program with no boundary and no
  // diagnostic — the failure only surfaced the day something panicked.
  if (!fb)
    throw new Error(
      `Tile "${def.name}" declares error-boundary=${def.errorBoundary}, which is not a tile`,
    );
  const fbCtx = makeEvalCtx(gen, ["$1"]);
  const fbBody = tileExprJs(fb.body, gen, fbCtx, under(enclosingTiles, fb.name));
  return `((() => { try { return ${body}; } catch (_err) { const ${bindRef(fbCtx, "$1")} = _s.boundaryPanic(_err, ${JSON.stringify(def.name)}); return ${fbBody}; } })())`;
}

/**
 * A tile lowered for the position a route names it in.
 *
 * A route target is a call site of that tile, so it gets what every other call
 * site gets: the `_named(…)` marker the runtime diffs `tile.mount` /
 * `tile.unmount` against (lifecycle.md §7.1.6), and its `error-boundary`
 * (§7.3, which scopes the boundary to renders *under that tile* — a statement
 * about the tile, not about where it was written).
 *
 * Separate from `genTile` because that has another caller: the `_tilesById`
 * table a `tile-test` compares against, which wants the bare tree — the
 * boundary would make a test on a panicking tile compare the fallback.
 *
 * It is the one application that cannot pass anything, so the target may
 * declare no `in=`: the entry lowers to `tile: () => …` — a `sub-routes`
 * parent to `tile: (_fill) => …`, whose one parameter is the outlet fill
 * described below, not an argument the target can read — and there is nothing
 * to bind `$1` to.
 *
 * `where` is the entry being lowered — `Route /x`, `Sub-route /x in tile "Y"`
 * — so the refusal names it, as the undefined-target throws beside the call
 * sites do. One `in=` tile can be named by several entries, and the throw is
 * reported without its stack.
 *
 * `fill` is the JS name of the outlet fill the runtime hands the factory
 * (`OutletFill` in the runtime). A tile that declares `sub-routes` calls it
 * around its own tree, *inside* its boundary, so the child the runtime injects
 * into the `route-outlet` is built under the parent's `try` / `catch` — the
 * §7.3 reading that a boundary covers what renders under the tile, the outlet
 * child included (#363). The child's own boundary, being inner, still wins.
 * A tile with no `sub-routes` has nothing to fill and takes no `fill`.
 */
export function genRouteTile(tile: TileDef, gen: GenCtx, where: string, fill?: string): string {
  // Unreachable: E0213 refuses the entry. It used to lower anyway, and the
  // mount died with `_d_1 is not defined` after `check` and `build` said ok.
  if (tile.in) throw new Error(`${where} targets tile "${tile.name}", which declares in=`);
  const named = `_named(${genTile(tile, gen)}, ${JSON.stringify(tile.name)})`;
  return boundaryJs(tile, fill ? `${fill}(${named})` : named, gen);
}

/**
 * What names a `for` in its implicit keys (runtime.md §10.3.10): the tile
 * definition it is written in and its ordinal among that definition's loops,
 * in source order (`App_0`, `App_1`, …). It is stable across renders, distinct
 * per loop in the source, and unchanged by an edit outside that definition or
 * a blank line above the loop, which a source position is not. `id` is the
 * loop's ordinal in the whole program, a JS-safe suffix for the names the
 * lowering declares (a tile name may hold a `-`).
 *
 * A loop no tile definition holds is in a tile-test's `expect` tree; it is
 * named in the order it is first lowered, under a name no tile can have.
 */
function loopName(t: TileExpr & { kind: "TileFor" }, gen: GenCtx): LoopName {
  let names = loopNames.get(gen.tiles);
  if (!names) {
    const table = new Map<TileExpr, LoopName>();
    for (const def of gen.tiles) {
      let n = 0;
      forEachLoop(def.body, (loop) => {
        table.set(loop, { name: `${def.name}_${n++}`, id: table.size });
      });
    }
    names = table;
    loopNames.set(gen.tiles, names);
  }
  const known = names.get(t);
  if (known) return known;
  const named = { name: `expect_${names.size}`, id: names.size };
  names.set(t, named);
  return named;
}

type LoopName = { readonly name: string; readonly id: number };

const loopNames = new WeakMap<readonly TileDef[], Map<TileExpr, LoopName>>();

/** Every `for` under `t`, outer before inner and in source order. */
function forEachLoop(t: TileExpr, f: (loop: TileExpr & { kind: "TileFor" }) => void): void {
  switch (t.kind) {
    case "TileFor":
      f(t);
      forEachLoop(t.body, f);
      return;
    case "TileWhen":
      forEachLoop(t.body, f);
      return;
    case "TileIf":
      forEachLoop(t.consequent, f);
      forEachLoop(t.alternate, f);
      return;
    case "TileMatch":
      for (const arm of t.arms) forEachLoop(arm.body, f);
      return;
    case "TileCall":
      for (const a of t.args) if (isTileExpr(a.value)) forEachLoop(a.value, f);
      return;
    default: {
      const unhandled: never = t;
      throw new Error(`forEachLoop: unhandled tile kind ${(unhandled as TileExpr).kind}`);
    }
  }
}

export function tileExprJs(
  t: TileExpr,
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTiles?: EnclosingTiles,
  // When the enclosing scope is a `TileFor`, this carries the implicit key
  // expression (the iteration's entry of `_s.loopKeys`) that any tile call in the body should
  // stamp on itself unless it declared an explicit `{key: …}`. Propagates
  // transparently through TileWhen / TileIf / TileMatch arms; resets at
  // user-tile boundaries (see `tileCallJs`).
  implicitKeyExpr?: string,
  // Explicit handlers written on the user-tile call sites whose tree `t` is the
  // root of, for every node `t` renders at its root to join (see
  // `explicitHandlers`). It follows the arms of a branch and each iteration of
  // a `for`, and continues through a nested call site; a child is not the
  // root, so it goes no further than that.
  rootHandlers?: HandlerWiring,
): string {
  switch (t.kind) {
    case "TileFor": {
      const iter = jsOfExpr(t.iter, ctx);
      const inner = childCtx(ctx);
      const bind = declareBind(inner, t.bind);
      // The implicit key of each iteration (runtime.md §10.3.10): `_s.loopKeys`
      // answers, per element, the loop, the occurrence of this value, and the
      // value's `show`. So a list that repeats a value, or two loops under one
      // parent that share one, still keys every child apart. The one exception
      // is a single loop in the source whose tile is expanded twice into one
      // parent's children: both expansions are the same loop.
      const { name, id } = loopName(t, gen);
      const keys = `__fk${id}`;
      const index = `__fi${id}`;
      const impl = `${keys}[${index}]`;
      const body = tileExprJs(t.body, gen, inner, enclosingTiles, impl, rootHandlers);
      // Returns Array<Node|Node[]>. Caller (collectChildren / _children) flattens.
      // A body whose every tile call carries its own `{key: …}` never reads the
      // implicit key, so the keys are not computed on each render.
      const list = body.includes(impl)
        ? `((__xs) => { const ${keys} = _s.loopKeys(__xs, ${JSON.stringify(name)}); return __xs.map((${bind}, ${index}) => (${body})); })((${iter}) || [])`
        : `((${iter}) || []).map((${bind}) => (${body}))`;
      // A `for` reached by an enclosing `for`'s implicit key — its body, or an
      // arm of a branch there — renders a list per outer iteration, each node
      // keyed by this loop alone, so siblings from different outer iterations
      // would collide once flattened. `_wk` pairs each node's key with the
      // outer iteration's.
      return implicitKeyExpr ? `_wk(${list}, ${implicitKeyExpr})` : list;
    }
    case "TileWhen":
      // Returns a Node or null. Caller flattens nulls away.
      return `((${jsOfExpr(t.cond, ctx)}) ? (${tileExprJs(t.body, gen, ctx, enclosingTiles, implicitKeyExpr, rootHandlers)}) : null)`;
    case "TileIf":
      return `((${jsOfExpr(t.cond, ctx)}) ? (${tileExprJs(t.consequent, gen, ctx, enclosingTiles, implicitKeyExpr, rootHandlers)}) : (${tileExprJs(t.alternate, gen, ctx, enclosingTiles, implicitKeyExpr, rootHandlers)}))`;
    case "TileMatch": {
      const sc = jsOfExpr(t.scrutinee, ctx);
      const arms = t.arms
        .map((arm) => {
          if (arm.pattern.kind === "PVariant") {
            const inner = childCtx(ctx);
            const binds = arm.pattern.binds
              .map((b, i) =>
                b !== "_" ? `const ${declareBind(inner, b)} = _v[${JSON.stringify(`_${i}`)}];` : "",
              )
              .join(" ");
            return `if (_s.variantIs(_v, ${JSON.stringify(arm.pattern.name)})) { ${binds} return ${tileExprJs(arm.body, gen, inner, enclosingTiles, implicitKeyExpr, rootHandlers)}; }`;
          }
          if (arm.pattern.kind === "PBind") {
            const inner = childCtx(ctx);
            const bind = declareBind(inner, arm.pattern.name);
            return `if (true) { const ${bind} = _v; return ${tileExprJs(arm.body, gen, inner, enclosingTiles, implicitKeyExpr, rootHandlers)}; }`;
          }
          if (arm.pattern.kind === "PWildcard") {
            return `if (true) { return ${tileExprJs(arm.body, gen, ctx, enclosingTiles, implicitKeyExpr, rootHandlers)}; }`;
          }
          // PTuple — TileMatch reuses the shared `tupleArm` helper. `ctx` carries
          // no reducerScope here (tile-match runs in pure render context), so the
          // arm reads `_live` like the rest of the tile.
          {
            const { guard, binds, inner } = tupleArm(arm.pattern, ctx, "_v");
            return `if (${guard}) { ${binds} return ${tileExprJs(arm.body, gen, inner, enclosingTiles, implicitKeyExpr, rootHandlers)}; }`;
          }
        })
        .join(" else ");
      // The no-match fallback renders an empty `text` tile, so the text family
      // must ship whenever a tile-match exists (#71).
      gen.usedTiles.add("text");
      return `((_v) => { ${arms} else { return { kind: "text", text: "" }; } })(${sc})`;
    }
    case "TileCall":
      return tileCallJs(
        t as TileExpr & { kind: "TileCall" },
        gen,
        ctx,
        enclosingTiles,
        implicitKeyExpr,
        rootHandlers,
      );
  }
}

/**
 * A `bind=` target lowered: the root slot, the static path below it, and a JS
 * expression reading the value there. Each control decides how it shows that
 * value — `_s.show(…)` for the text controls, as-is for the others.
 */
export type BindInfo = { root: string; path: BindSegment[]; read: string };

/**
 * For `bind=draft` or `bind=draft.get.title`, extract the root slot name, the
 * static path, and a JS expression to read the value — the target as
 * `bindTarget` reads it, which is what the checker asks to be a slot (E0229).
 * Only static field-access paths are supported (no Index, no dynamic lookups).
 * Returns null if no `bind=` arg exists or the path isn't statically resolvable.
 */
export function extractBindPath(args: { name?: string; value: unknown }[]): BindInfo | null {
  const bindArg = args.find((a) => a.name === "bind");
  if (!bindArg) return null;
  const target = bindTarget(bindArg.value as Expr);
  if (target.root.kind !== "Ref" || target.path === null) return null;
  const root = target.root.name;
  const path = target.path;
  // Build a safe reader: `((_live["root"] ?? {})["a"] ?? {})["b"] ...`.
  let readRaw = `_live[${JSON.stringify(root)}]`;
  for (const seg of path) {
    readRaw =
      typeof seg === "string"
        ? `((${readRaw}) ?? {})[${JSON.stringify(seg)}]`
        : `_s.unwrap(${readRaw})`;
  }
  return { root, path, read: readRaw };
}

/**
 * The `bind` / `bindPath` fields of a bound control's node — every bound kind
 * goes through here, so `bindPath` is omitted for a bare slot in one place.
 */
function bindFields(bindInfo: Pick<BindInfo, "root" | "path">): string[] {
  const fields = [`bind: ${JSON.stringify(bindInfo.root)}`];
  if (bindInfo.path.length > 0) fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
  return fields;
}

/**
 * `check` / `switch`: a box that is ticked from `bind=` when it has one — the
 * `Bool` it writes back on change (forms.md §5.1.1) — and from `value=` when it
 * does not.
 */
function toggleJs(
  kind: "check" | "switch",
  t: TileExpr & { kind: "TileCall" },
  ctx: EvalCtx,
  propsObj: string,
): string {
  const bindInfo = extractBindPath(t.args);
  const fields = [`kind: ${JSON.stringify(kind)}`];
  if (bindInfo) {
    fields.push(...bindFields(bindInfo), `checked: !!(${bindInfo.read})`);
  } else {
    const valArg = t.args.find((a) => a.name === "value");
    fields.push(`checked: !!(${valArg ? jsOfExpr(asExpr(valArg.value), ctx) : "false"})`);
  }
  fields.push(`props: ${propsObj}`);
  return `({ ${fields.join(", ")} })`;
}

/**
 * The reading an `input`'s text is parsed by before it is written to the slot
 * it binds (forms.md §5.1.1), decided by the bound position's type alone. That
 * type is followed from the slot through the path — a record field, an
 * `Option`'s or a `Result`'s payload — to the base it unaliases to, as
 * `T.parse` resolves its qualifier, so a `type Qty = Int where positive` or a
 * `nominal Int` reads as an `Int`. Which `type=` a base goes with is not asked
 * here: a field kind the base does not go with is E0226 at check time.
 * `null` for `Text`, which is written as typed, and for a position whose type
 * cannot be read.
 */
function boundReading(
  bindInfo: { root: string; path: BindSegment[] },
  gen: GenCtx,
): "Int" | "Float" | "Time" | null {
  let t: TypeExpr | null = gen.slots.find((s) => s.name === bindInfo.root)?.type ?? null;
  for (const seg of bindInfo.path) {
    const u = unaliasType(t, gen);
    if (typeof seg === "string") {
      t = u?.kind === "TypeRecord" ? (u.fields.find((f) => f.name === seg)?.type ?? null) : null;
    } else {
      t =
        u?.kind === "TypeApp" && (u.name === "Option" || u.name === "Result")
          ? (u.args[0] ?? null)
          : null;
    }
  }
  const base = unaliasType(t, gen);
  if (base?.kind !== "TypePrim") return null;
  return base.name === "Int" || base.name === "Float" || base.name === "Time" ? base.name : null;
}

const readerName = (reading: ParseReading): string => `_read${reading}`;

/**
 * One reader per reading an app's bound inputs use, declared once inside
 * `createApp()`: its `read` is `(text) => Option(T)`, the same reading `T.parse`
 * lowers to — the base's reading only; a refinement the slot's type carries is
 * applied by the slot gate after it. `as` names the base, so a refused text
 * can say which reading it failed (forms.md §5.7.2).
 */
export function bindReaderDecls(readings: ReadonlySet<ParseReading>): string[] {
  return [...readings]
    .sort()
    .map(
      (r) =>
        `const ${readerName(r)} = { as: ${JSON.stringify(r)}, read: (_t) => ${readingJs(r, "_t")} };`,
    );
}

/**
 * What a bound `input` shows. A `Time` is a millisecond number, and a date
 * field takes `yyyy-MM-dd` (a `datetime-local` one `yyyy-MM-ddTHH:mm`) on the
 * local clock `Time.parse` reads a zone-less string on — so the text the field
 * shows reads back as the same day (date) or the same minute (datetime-local)
 * as the instant it came from, not the same millisecond. Everything else shows
 * as `show` does.
 */
function boundInputValueJs(
  reading: ParseReading | null,
  t: TileExpr & { kind: "TileCall" },
  readJs: string,
): string {
  if (reading === "Time") {
    const typeArg = t.args.find((a) => a.name === "type")?.value as Expr | undefined;
    const pattern = typeArg?.kind === "Str" ? TIME_INPUT_PATTERNS.get(typeArg.value) : undefined;
    if (pattern) return `_s.formatTime(${readJs}, ${JSON.stringify(pattern)})`;
  }
  return `_s.show(${readJs})`;
}

function tileCallJs(
  t: TileExpr & { kind: "TileCall" },
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTiles?: EnclosingTiles,
  implicitKeyExpr?: string,
  rootHandlers?: HandlerWiring,
): string {
  const name = t.name;
  // Explicit `{key: <expr>}` on the tile call wins over the enclosing
  // TileFor's implicit key. `null` means no wrap.
  const keyJs = keyFor(t, ctx) ?? implicitKeyExpr ?? null;
  const wrap = (lit: string): string => (keyJs ? `_wk(${lit}, ${keyJs})` : lit);

  if (!BUILTIN_TILES.has(name)) {
    const def = gen.tiles.find((x) => x.name === name);
    if (!def) throw new Error(`Tile "${name}" not found`);
    // The callee's body is lowered in a scope of its own. A tile is a pure
    // function of the slots and its `in` argument (language.md §1.7.2
    // Invariant 1), so none of the caller's `for` / `match` bindings are
    // visible in it: a name the body reads as a slot stays the slot wherever
    // the tile is called from.
    const inner = makeEvalCtx(gen, new Set<string>());
    // The first positional argument, which is the set `checkTileInput` counts:
    // the two have to read the same one, or a call the checker approved lowers
    // to something else. A named argument is a prop and goes to `propsFor`.
    const arg1 = firstPositional(t);
    const wrapBoundary = (body: string): string => boundaryJs(def, body, gen, enclosingTiles);
    // Each user-tile call site wraps its rendered output with `_named(…, "X")`
    // so the runtime can diff `tile.mount(X)` / `tile.unmount(X)` against the
    // rendered tree (lifecycle.md §7.1.6). Builtin tiles are NOT named — only
    // user-defined tile boundaries fire mount/unmount.
    const nameLit = JSON.stringify(def.name);
    // The handlers written here — plus any handed down from call sites this one
    // is the root of — belong to the nodes the body renders at its root, so
    // they go down to each one's `propsFor` and join what is wired there. The
    // props left for `_attachProps` to merge are data only: a handler spread
    // over the finished node would replace the ones it already has.
    const handlers = explicitHandlers(t, rootHandlers);
    const callSiteProps = (): string => propsFor(t, ctx, undefined, new Map());
    const bodyHandlers = handlers.size > 0 ? handlers : undefined;
    if (arg1) {
      const v = arg1.value;
      // `checkTileInput` rejects a tile expression as the positional argument
      // (E0213 without `in=`, E0201 with it), so a checked program never
      // passes one here.
      if (isTileExpr(v)) {
        throw new Error(`Tile "${name}" called with a tile as its positional argument`);
      }
      // Evaluate the positional arg and props in the OUTER context (where
      // `_d_1` still refers to the enclosing tile's `$1`), then pass them in
      // as arguments so the inner IIFE can rebind `_d_1` without colliding
      // with the outer scope.
      const oneJs = jsOfExpr(v as Expr, ctx);
      const propsJs = callSiteProps();
      const bodyCtx = addBind(inner, "$1");
      const bodyJs = tileExprJs(
        def.body,
        gen,
        bodyCtx,
        under(enclosingTiles, def.name),
        undefined,
        bodyHandlers,
      );
      return wrap(
        wrapBoundary(
          `((_arg, _propsOuter) => { const ${bindRef(bodyCtx, "$1")} = _arg; return _named(_attachProps(${bodyJs}, _propsOuter), ${nameLit}); })(${oneJs}, ${propsJs})`,
        ),
      );
    }
    const propsJs = callSiteProps();
    const bodyJs = tileExprJs(
      def.body,
      gen,
      inner,
      under(enclosingTiles, def.name),
      undefined,
      bodyHandlers,
    );
    return wrap(wrapBoundary(`_named(_attachProps(${bodyJs}, ${propsJs}), ${nameLit})`));
  }

  // Builtin tiles. Each case returns the object-literal JS for one node.
  // Wrapping is centralised at the tail (`return wrap(lit)`) so every builtin
  // uniformly picks up `_wk(..., key)` when the call site has an explicit or
  // implicit key, without touching each individual case.
  gen.usedTiles.add(name);
  const propsObj = propsFor(t, ctx, enclosingTiles, explicitHandlers(t, rootHandlers));
  const emitBuiltin = (): string => {
    switch (name) {
      case "page":
      case "row":
      case "column":
      case "card":
      case "box":
      case "grid":
      case "stack":
      case "overlay":
      case "region":
      case "scroll":
      case "divider":
      case "fieldset":
      case "list-item":
      case "table":
      case "table-head":
      case "table-body":
      case "table-row":
      case "panel": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        return `({ kind: ${JSON.stringify(name)}, children: [${children}], props: ${propsObj} })`;
      }
      case "heading": {
        const text = contentJs(t, ctx);
        return `({ kind: "heading", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "text": {
        const text = contentJs(t, ctx);
        return `({ kind: "text", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "button": {
        const textArg = t.args.find((a) => a.name === "text");
        const textJs = textArg ? jsOfExpr(asExpr(textArg.value), ctx) : '""';
        // `type=` decides whether this button submits the form it is inside
        // (forms.md §5.2.2). Emitted only when written, so a button that says
        // nothing keeps the HTML default rather than being given one here.
        const typeArg = t.args.find((a) => a.name === "type");
        const typeField = typeArg ? `type: ${jsOfExpr(asExpr(typeArg.value), ctx)}, ` : "";
        return `({ kind: "button", text: _s.show(${textJs}), ${typeField}props: ${propsObj} })`;
      }
      case "input": {
        const fields: string[] = [`kind: "input"`];
        const bindInfo = extractBindPath(t.args);
        for (const arg of t.args) {
          if (!arg.name || arg.name === "bind") continue;
          const valJs = jsOfExpr(asExpr(arg.value), ctx);
          if (arg.name === "value") fields.push(`value: _s.show(${valJs})`);
          else if (arg.name === "placeholder") fields.push(`placeholder: ${valJs}`);
          else if (arg.name === "type") fields.push(`type: ${valJs}`);
          else if (arg.name === "id") fields.push(`id: ${valJs}`);
          else if (arg.name === "auto-focus") fields.push(`autoFocus: ${valJs}`);
          else if (arg.name === "required") fields.push(`required: ${valJs}`);
          else if (arg.name === "accept") fields.push(`accept: ${valJs}`);
          else if (arg.name === "multiple") fields.push(`multiple: ${valJs}`);
        }
        if (bindInfo) {
          fields.push(...bindFields(bindInfo));
          const reading = boundReading(bindInfo, gen);
          if (reading) {
            gen.usedReaders.add(reading);
            fields.push(`parse: ${readerName(reading)}`);
          }
          fields.push(`value: ${boundInputValueJs(reading, t, bindInfo.read)}`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "textarea": {
        const fields: string[] = [`kind: "textarea"`];
        const bindInfo = extractBindPath(t.args);
        for (const arg of t.args) {
          if (!arg.name || arg.name === "bind") continue;
          const valJs = jsOfExpr(asExpr(arg.value), ctx);
          if (arg.name === "value") fields.push(`value: _s.show(${valJs})`);
          else if (arg.name === "placeholder") fields.push(`placeholder: ${valJs}`);
          else if (arg.name === "id") fields.push(`id: ${valJs}`);
          else if (arg.name === "rows") fields.push(`rows: ${valJs}`);
        }
        if (bindInfo) fields.push(...bindFields(bindInfo), `value: _s.show(${bindInfo.read})`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "check":
      case "switch":
        return toggleJs(name, t, ctx, propsObj);
      case "select": {
        const fields: string[] = [`kind: "select"`];
        const bindInfo = extractBindPath(t.args);
        if (bindInfo) {
          fields.push(...bindFields(bindInfo), `value: ${bindInfo.read}`);
        } else {
          // No bind=; allow `value=<expr>` for read-only / dispatch-via-reducer selects.
          const valArg = t.args.find((a) => a.name === "value");
          if (valArg) fields.push(`value: ${jsOfExpr(asExpr(valArg.value), ctx)}`);
        }
        const optionsArg = t.args.find((a) => a.name === "options");
        if (optionsArg) {
          fields.push(`options: ${jsOfExpr(asExpr(optionsArg.value), ctx)}`);
        } else {
          fields.push(`options: []`);
        }
        const placeholderArg = t.args.find((a) => a.name === "placeholder");
        if (placeholderArg) {
          fields.push(`placeholder: ${jsOfExpr(asExpr(placeholderArg.value), ctx)}`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "radio": {
        const fields: string[] = [`kind: "radio"`];
        const bindInfo = extractBindPath(t.args);
        let valueJs: string | undefined;
        for (const arg of t.args) {
          if (!arg.name || arg.name === "bind") continue;
          const valJs = jsOfExpr(asExpr(arg.value), ctx);
          if (arg.name === "group") fields.push(`group: ${valJs}`);
          else if (arg.name === "value") valueJs = valJs;
          // A bind decides the selection itself, below; `selected=` beside
          // one is a second answer to the same question, and is not read
          // (W0216 says so at `kumiki check` time).
          else if (arg.name === "selected" && !bindInfo) fields.push(`selected: !!(${valJs})`);
        }
        if (valueJs !== undefined) {
          fields.push(`value: ${valueJs}`);
          // A bound radio with no `value=` has nothing to write when chosen
          // and is E0225, so a bind is lowered only beside the value it writes.
          if (bindInfo) {
            // Chosen exactly when the bound slot holds this radio's value
            // (forms.md §5.5.2), compared as `==` compares.
            fields.push(...bindFields(bindInfo), `selected: _s.eq(${bindInfo.read}, ${valueJs})`);
          }
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "spinner":
        return `({ kind: "spinner", props: ${propsObj} })`;
      case "form": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        return `({ kind: "form", children: [${children}], props: ${propsObj} })`;
      }
      case "label": {
        const text = contentJs(t, ctx);
        return `({ kind: "label", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "link": {
        const toArg = t.args.find((a) => a.name === "to");
        const to = toArg ? jsOfExpr(asExpr(toArg.value), ctx) : '""';
        // The label is the content argument (the first positional one, else
        // `text=`); the `{text: …}` prop form is also accepted for back-compat
        // (§1.7.1).
        const textArg = contentArg(t);
        const textProp = t.props.find((p) => p.name === "text");
        const textExpr = textArg ? asExpr(textArg.value) : textProp ? textProp.value : undefined;
        const text = textExpr ? jsOfExpr(textExpr, ctx) : '""';
        // §3.8 prefetch — the prop value is a bare reducer ident (Ref) or a
        // string literal. We surface it as a literal string so the runtime can
        // route it through `_dispatch` without re-resolving identifiers.
        const fields = [`kind: "link"`, `text: _s.show(${text})`, `to: _s.show(${to})`];
        const prefetchProp = t.props.find((p) => p.name === "prefetch");
        if (prefetchProp) {
          const v = prefetchProp.value as Expr;
          if (v.kind === "Ref") {
            fields.push(`prefetch: ${JSON.stringify((v as Expr & { name: string }).name)}`);
          } else if (v.kind === "Str") {
            fields.push(`prefetch: ${JSON.stringify((v as Expr & { value: string }).value)}`);
          } else {
            fields.push(`prefetch: ${jsOfExpr(v, ctx)}`);
          }
        }
        const prefetchArgsProp = t.props.find((p) => p.name === "prefetch-args");
        if (prefetchArgsProp) {
          fields.push(`prefetchArgs: ${jsOfExpr(prefetchArgsProp.value, ctx)}`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "markdown": {
        const text = contentJs(t, ctx);
        return `({ kind: "markdown", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "skeleton":
        return `({ kind: "skeleton", props: ${propsObj} })`;
      case "image": {
        const src = contentArg(t);
        const srcJs = src ? jsOfExpr(asExpr(src.value), ctx) : '""';
        return `({ kind: "image", src: _s.show(${srcJs}), props: ${propsObj} })`;
      }
      case "icon": {
        const name = contentArg(t);
        const nameExpr = name ? asExpr(name.value) : null;
        // String-literal names get captured so the toolchain can bake matching
        // entries from the project's icon registry into `App.icons` (#101). Other
        // forms (Ref, expression) resolve dynamically through `theme.icons` at
        // runtime — no compile-time bundling.
        if (nameExpr && nameExpr.kind === "Str") {
          const literal = (nameExpr as Expr & { value: string }).value;
          if (literal) ctx.gen.usedIcons.add(literal);
        }
        const nameJs = nameExpr ? jsOfExpr(nameExpr, ctx) : '""';
        return `({ kind: "icon", name: _s.show(${nameJs}), props: ${propsObj} })`;
      }
      case "code": {
        const text = contentJs(t, ctx);
        const langArg = t.args.find((a) => a.name === "lang");
        const lang = langArg ? `_s.show(${jsOfExpr(asExpr(langArg.value), ctx)})` : "undefined";
        return `({ kind: "code", text: _s.show(${text}), lang: ${lang}, props: ${propsObj} })`;
      }
      case "video": {
        const fields: string[] = [`kind: "video"`];
        const src = t.args.find((a) => a.name === "src");
        if (src) fields.push(`src: _s.show(${jsOfExpr(asExpr(src.value), ctx)})`);
        const controls = t.args.find((a) => a.name === "controls");
        if (controls) fields.push(`controls: !!(${jsOfExpr(asExpr(controls.value), ctx)})`);
        const autoplay = t.args.find((a) => a.name === "autoplay");
        if (autoplay) fields.push(`autoplay: !!(${jsOfExpr(asExpr(autoplay.value), ctx)})`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "list": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        const ordered = t.args.find((a) => a.name === "ordered");
        const ord = ordered ? `!!(${jsOfExpr(asExpr(ordered.value), ctx)})` : "false";
        return `({ kind: "list", ordered: ${ord}, children: [${children}], props: ${propsObj} })`;
      }
      case "table-cell": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        const fields: string[] = [`kind: "table-cell"`, `children: [${children}]`];
        const colspan = t.args.find((a) => a.name === "colspan");
        if (colspan) fields.push(`colspan: ${jsOfExpr(asExpr(colspan.value), ctx)}`);
        const rowspan = t.args.find((a) => a.name === "rowspan");
        if (rowspan) fields.push(`rowspan: ${jsOfExpr(asExpr(rowspan.value), ctx)}`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "modal":
      case "drawer":
      case "popover": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        const fields: string[] = [`kind: ${JSON.stringify(name)}`, `children: [${children}]`];
        const open = t.args.find((a) => a.name === "open");
        fields.push(`open: ${open ? `!!(${jsOfExpr(asExpr(open.value), ctx)})` : "true"}`);
        for (const key of ["title", "side", "placement"]) {
          const a = t.args.find((x) => x.name === key);
          if (a) fields.push(`${key}: _s.show(${jsOfExpr(asExpr(a.value), ctx)})`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "tooltip": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        const fields: string[] = [`kind: "tooltip"`, `children: [${children}]`];
        const text = t.args.find((a) => a.name === "text");
        if (text) fields.push(`text: _s.show(${jsOfExpr(asExpr(text.value), ctx)})`);
        const placement = t.args.find((a) => a.name === "placement");
        if (placement) fields.push(`placement: _s.show(${jsOfExpr(asExpr(placement.value), ctx)})`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "toast": {
        const fields: string[] = [`kind: "toast"`];
        const level = t.args.find((a) => a.name === "kind");
        if (level) fields.push(`level: _s.show(${jsOfExpr(asExpr(level.value), ctx)})`);
        const text = t.args.find((a) => a.name === "text");
        if (text) fields.push(`text: _s.show(${jsOfExpr(asExpr(text.value), ctx)})`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "progress": {
        const fields: string[] = [`kind: "progress"`];
        const value = t.args.find((a) => a.name === "value");
        if (value) fields.push(`value: ${jsOfExpr(asExpr(value.value), ctx)}`);
        const max = t.args.find((a) => a.name === "max");
        if (max) fields.push(`max: ${jsOfExpr(asExpr(max.value), ctx)}`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "slider": {
        const fields: string[] = [`kind: "slider"`];
        const bindInfo = extractBindPath(t.args);
        for (const arg of t.args) {
          if (!arg.name || arg.name === "bind") continue;
          const valJs = jsOfExpr(asExpr(arg.value), ctx);
          if (arg.name === "min") fields.push(`min: ${valJs}`);
          else if (arg.name === "max") fields.push(`max: ${valJs}`);
          else if (arg.name === "step") fields.push(`step: ${valJs}`);
        }
        if (bindInfo) fields.push(...bindFields(bindInfo), `value: ${bindInfo.read}`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "error": {
        const fieldArg = t.args.find((a) => a.name === "field");
        const fieldName =
          fieldArg && (fieldArg.value as Expr).kind === "Ref"
            ? (fieldArg.value as Expr & { name: string }).name
            : "";
        return `({ kind: "error", field: ${JSON.stringify(fieldName)}, props: ${propsObj} })`;
      }
      case "route-outlet":
        return `({ kind: "route-outlet", children: [], props: ${propsObj} })`;
      case "details": {
        // <details>: `summary=` supplies the disclosure label; unnamed args
        // are the collapsed children. `open` is optional and defaults to
        // false so the panel starts collapsed (native browser default).
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        const summaryArg = t.args.find((a) => a.name === "summary");
        const summary = summaryArg ? jsOfExpr(asExpr(summaryArg.value), ctx) : '""';
        const fields: string[] = [
          `kind: "details"`,
          `summary: _s.show(${summary})`,
          `children: [${children}]`,
        ];
        const openArg = t.args.find((a) => a.name === "open");
        if (openArg) fields.push(`open: !!(${jsOfExpr(asExpr(openArg.value), ctx)})`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "editable": {
        // contenteditable: the content argument supplies initial content;
        // `bind=` optionally writes back user edits. Mirrors the input /
        // textarea shape so codegen for text-in-bind is uniform.
        const fields: string[] = [`kind: "editable"`];
        const bindInfo = extractBindPath(t.args);
        const textJs = contentJs(t, ctx);
        if (bindInfo) {
          fields.push(...bindFields(bindInfo), `text: _s.show(${bindInfo.read})`);
        } else {
          fields.push(`text: _s.show(${textJs})`);
        }
        const idArg = t.args.find((a) => a.name === "id");
        if (idArg) fields.push(`id: ${jsOfExpr(asExpr(idArg.value), ctx)}`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
    }
    throw new Error(`Unsupported builtin tile "${name}"`);
  };
  return wrap(emitBuiltin());
}

/**
 * The first positional argument of a user tile call: its input. A named
 * argument is a prop wherever it is written. A builtin's content is read by
 * the same rule, through `contentArg`.
 */
function firstPositional(t: TileExpr & { kind: "TileCall" }): TileArg | undefined {
  return t.args.find((a) => a.name === undefined);
}

/**
 * A value builtin's content as JS — the argument `contentArg` names from the
 * shared table — and `""` when the call writes none.
 */
function contentJs(t: TileExpr & { kind: "TileCall" }, ctx: EvalCtx): string {
  const arg = contentArg(t);
  return arg ? jsOfExpr(asExpr(arg.value), ctx) : '""';
}

function asExpr(v: Expr | TileExpr): Expr {
  return v as Expr;
}

function collectChildren(
  args: { kind: "TileArg"; name?: string; value: Expr | TileExpr }[],
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTiles?: EnclosingTiles,
): string {
  const parts: string[] = [];
  for (const a of args) {
    if (a.name) continue; // skip named args at container level
    const v = a.value;
    if (isTileExpr(v)) {
      parts.push(tileExprJs(v, gen, ctx, enclosingTiles));
    } else if ((v as Expr).kind === "Ref") {
      const refName = (v as Expr & { name: string }).name;
      const def = gen.tiles.find((x) => x.name === refName);
      if (def) {
        parts.push(tileExprJs(def.body, gen, ctx, under(enclosingTiles, def.name)));
      } else {
        parts.push("null");
      }
    }
  }
  // Wrap in _children(...) so the runtime can flatten arrays and drop nulls.
  return `..._children(${parts.join(", ")})`;
}
