import { isTileExpr, type TileExpr, type UiEventKind } from "../ast.ts";
import { HANDLER_NAMES, handlerReducerName, UI_LIFTS } from "../ui-lifts.ts";
import { type EnclosingTiles, type EvalCtx, handlerRef, jsProperty } from "./context.ts";
import { jsOfExpr } from "./expr.ts";

/**
 * Author-supplied `{key: expr}` on a tile-call's props block, as a JS
 * expression string, or `null` when absent. Used by codegen to lift tile
 * identity out of the prop bag onto the emitted TileNode's top-level `key`.
 * Explicit keys always win over TileFor's implicit key.
 */
export function keyFor(t: TileExpr & { kind: "TileCall" }, ctx: EvalCtx): string | null {
  const keyProp = t.props.find((p) => p.name === "key");
  if (!keyProp) return null;
  return `_s.show(${jsOfExpr(keyProp.value, ctx)})`;
}

/**
 * Names that never become prop data, whichever way they are written.
 *
 * One predicate rather than one list per loop: the top-level props, the `el`
 * payload and the named-argument fold all have to agree about what is not a
 * prop, and three copies of the list is three places for them to stop agreeing.
 * `forEl` adds the two the reducer payload alone excludes.
 */
function isNotPropData(tile: string, name: string, forEl = false): boolean {
  if (HANDLER_NAMES.has(name)) return true;
  // `key` is lifted to the TileNode's top level by `_wk` at the tile-call
  // boundary; it must not also flow into `props` or `el`.
  if (name === "key") return true;
  // §3.8 link prefetch — the link tile lifts these into top-level fields, and
  // their value space (a reducer name / an argument record) is not slot data.
  if (tile === "link" && (name === "prefetch" || name === "prefetch-args")) return true;
  // §4.3 style block — a CSS prop bag the runtime applies to `el.style`. It is
  // not reducer data, and shipping it twice re-evaluates every `@token` ref.
  if (forEl && name === "style") return true;
  // An lvalue (`todos[i].done`), not a value: lowering it emits a read of the
  // slot under a name nothing consults.
  if (forEl && name === "bind") return true;
  return false;
}

/** The ARIA a tile asked for: the `aria` map, plus each `aria-*` written on its own. */
type AriaParts = { map: string | null; direct: Array<[attr: string, js: string]> };

/**
 * Take one prop or argument if it is ARIA, and say whether it was taken.
 *
 * Both spellings the spec uses — the `aria` map (stdlib.md §2.3.10) and a bare
 * `aria-label` (style.md §4.4.4, and what the a11y checks look for) — are
 * merged into the map here rather than in the runtime. The runtime cannot do
 * it: finding `aria-*` among the props means enumerating the props bag, and on
 * the render path that bag may belong to a host tile (#71) whose object refuses
 * enumeration — a throw there rebuilds the whole tree.
 */
function collectAria(name: string, js: () => string, into: AriaParts): boolean {
  if (name === "aria") {
    into.map = js();
    return true;
  }
  if (!name.startsWith("aria-")) return false;
  into.direct.push([name, js()]);
  return true;
}

/** The single `aria` value for a tile, or `null` when it asked for none. */
function mergedAria(parts: AriaParts): string | null {
  if (parts.map === null && parts.direct.length === 0) return null;
  // The map first: a name written on its own is the more specific of the two.
  const fields = [
    ...(parts.map === null ? [] : [`...(${parts.map})`]),
    ...parts.direct.map(([attr, js]) => `${JSON.stringify(attr)}: ${js}`),
  ];
  return `{ ${fields.join(", ")} }`;
}

/**
 * Explicit event-handler wirings, by handler name: `onClick` -> the reducers
 * written for it.
 */
export type HandlerWiring = ReadonlyMap<string, readonly string[]>;

/**
 * The explicit handlers written on one tile call (`onClick=foo`,
 * `{onClick: foo}`), joined with `inherited`: the ones written on the user-tile
 * call sites whose tree this call is the root of. A handler written on
 * `Btn {onClick: r}` belongs to the node `Btn` renders, so it is handed down to
 * that node's own `propsFor` and joins what is already wired there.
 */
export function explicitHandlers(
  t: TileExpr & { kind: "TileCall" },
  inherited?: HandlerWiring,
): Map<string, string[]> {
  const byHandler = new Map<string, string[]>();
  const record = (handlerName: string, reducerName: string | null): void => {
    if (reducerName === null) return;
    const list = byHandler.get(handlerName) ?? [];
    list.push(reducerName);
    byHandler.set(handlerName, list);
  };
  // Whatever shape the parser gave the name — a reference, a variant tag, an
  // argument-less tile call — `handlerReducerName` reads the reducer out of
  // it, the same one the checker resolved. Deciding here on `kind === "Ref"`
  // instead is what left a capitalised reducer name rejected by the checker
  // and wired by nobody.
  for (const a of t.args) {
    if (a.name && HANDLER_NAMES.has(a.name)) record(a.name, handlerReducerName(a.value));
  }
  for (const p of t.props) {
    if (HANDLER_NAMES.has(p.name)) record(p.name, handlerReducerName(p.value));
  }
  for (const [handlerName, names] of inherited ?? []) {
    for (const n of names) record(handlerName, n);
  }
  return byHandler;
}

/**
 * The reducers one handler dispatches: each once, in DEFINITION order.
 *
 * That is §1.6.4 Invariant 3 for every reducer matching one event, however it
 * was wired — written on the builtin, written on a user-tile call site whose
 * tree the element roots, or lifted from a `ui.<ev>(<Tile>)` subscription. One
 * rule, so where a handler happens to be written never decides what runs
 * first.
 *
 * A reducer name counts once, so writing `onClick=inc` beside
 * `reducer inc on=ui.click(B)` does not run `inc` twice per click.
 */
function inDefinitionOrder(names: readonly string[], ctx: EvalCtx): string[] {
  const rank = new Map<string, number>();
  ctx.gen.reducers.forEach((r, i) => {
    if (!rank.has(r.name)) rank.set(r.name, i);
  });
  // A name no reducer has is E0102 and never reaches codegen; ranking it last
  // keeps the sort total rather than asserting that.
  const at = (n: string): number => rank.get(n) ?? Number.MAX_SAFE_INTEGER;
  return [...new Set(names)].sort((a, b) => at(a) - at(b));
}

export function propsFor(
  t: TileExpr & { kind: "TileCall" },
  ctx: EvalCtx,
  // Every user tile this call renders under, outermost first — a selector
  // naming any of them reaches this node. See `EnclosingTiles`.
  enclosingTiles?: EnclosingTiles,
  // The explicit handlers this node dispatches. By default the ones written on
  // this call; `tileCallJs` passes more when user-tile call sites handed theirs
  // down, and none to a call site that handed its own down, so nothing is
  // emitted twice.
  explicitByHandler: HandlerWiring = explicitHandlers(t),
): string {
  const entries: string[] = [];
  // `{aria: {...}}` and `{aria-label: "…"}` are one channel by the time they
  // reach the runtime — see `mergedAria`.
  const aria: AriaParts = { map: null, direct: [] };

  // props block. A handler is wiring rather than data: it is in
  // `explicitByHandler`, and is emitted with the lifted ones below.
  for (const p of t.props) {
    if (HANDLER_NAMES.has(p.name)) continue;
    if (isNotPropData(t.name, p.name)) continue;
    if (collectAria(p.name, () => jsOfExpr(p.value, ctx), aria)) continue;
    entries.push(`${jsProperty(p.name)}: ${jsOfExpr(p.value, ctx)}`);
  }

  // Join explicit wirings with the reducers subscribing to (an enclosing tile,
  // ev) into one chained handler per event, in the order `inDefinitionOrder`
  // gives — so adding a `reducer foo on=ui.click(B)` never silently shadows an
  // existing `onClick=bar` on `B`, and vice versa.
  const emittedHandlers = new Set<string>();
  const pushHandler = (ev: UiEventKind | null, handlerName: string): void => {
    const explicit = explicitByHandler.get(handlerName) ?? [];
    const implicit: string[] =
      ev !== null && enclosingTiles !== undefined && enclosingTiles.length > 0
        ? ctx.gen.reducers
            .filter(
              (rr) =>
                rr.on.kind === "UiEvent" &&
                rr.on.ev === ev &&
                enclosingTiles.includes(rr.on.selector.tile),
            )
            .map((r) => r.name)
        : [];
    const names = inDefinitionOrder([...explicit, ...implicit], ctx);
    if (names.length === 0) return;
    // `_h` memoises one closure per reducer list inside the enclosing
    // `createApp()` scope, so re-rendering the same tile yields the *same*
    // function reference and the reconciler's field comparison can tell "same
    // handler" from "different handler" by identity. It also dispatches
    // through that scope's own `App`, so several compiled apps on one page
    // never cross-wire through a shared global.
    entries.push(`${handlerName}: ${handlerRef(names)}`);
    emittedHandlers.add(handlerName);
  };
  // Implicit-lift: every ui-event whose tile-kind gate matches `t.name` lifts
  // a chained handler. `tiles === null` (currently only `hover`) means "any
  // tile" — the runtime's universal `applyUiEventHandlers` wires it. The full
  // table — including the runtime-event ≠ emit-prop divergence for
  // check/radio/switch — lives in `ui-lifts.ts`.
  for (const lift of UI_LIFTS) {
    if (lift.tiles !== null && !lift.tiles.has(t.name)) continue;
    pushHandler(lift.ev, lift.handler);
  }
  // Flush explicit handlers that have no implicit codepath on this tile —
  // e.g. `onClose` on a dialog, or `onClick=foo` on a non-button tile.
  for (const [handlerName, names] of explicitByHandler) {
    if (emittedHandlers.has(handlerName)) continue;
    entries.push(`${handlerName}: ${handlerRef(inDefinitionOrder(names, ctx))}`);
  }
  // Build `el` from explicit {name: expr} that aren't handlers
  const elProps: string[] = [];
  for (const p of t.props) {
    if (isNotPropData(t.name, p.name, true)) continue;
    if (p.name === "aria" || p.name.startsWith("aria-")) continue;
    elProps.push(`${jsProperty(p.name)}: ${jsOfExpr(p.value, ctx)}`);
  }
  // A named argument carries the same prop as the block form of the same name.
  // The spec writes the two interchangeably — `button(text="Log in",
  // loading=loginPending)` in forms.md §5.2 next to `{variant: "ghost"}` in
  // §5.9 — so they have to arrive alike. Per-kind lowering lifts the arguments
  // each tile names (`text`, `src`, `type`, `bind`, …) into top-level TileNode
  // fields; every OTHER named argument used to be dropped here, which is how
  // `image(alt="…")` satisfied the a11y check and then rendered no `alt`, and
  // how `button(disabled=true)` rendered an enabled button.
  //
  // This generalizes the §1.6.2 `id` fold that used to stand alone: `id` needed
  // it so a `Foo#bar` selector matches `input(id="bar")`, and every other
  // argument needs it for the same reason — it is prop data, and props are
  // where the renderers and the `$el` payload look. Arguments a kind also lifts
  // are folded rather than enumerated away: a list of "what each kind already
  // took" would have to stay in step with forty lowering cases, and the day it
  // fell behind, a prop would go missing exactly the way this fixes.
  const written = new Set(t.props.map((p) => p.name));
  for (const a of t.args) {
    if (!a.name || written.has(a.name)) continue;
    if (isNotPropData(t.name, a.name, true)) continue;
    // Children arrive as arguments too (`card(header=Some(…))`). A tile is not
    // prop data, and lowering one here would build a second copy of its node.
    if (isTileExpr(a.value)) continue;
    const js = jsOfExpr(a.value, ctx);
    if (collectAria(a.name, () => js, aria)) continue;
    entries.push(`${jsProperty(a.name)}: ${js}`);
    elProps.push(`${jsProperty(a.name)}: ${js}`);
  }
  const ariaJs = mergedAria(aria);
  if (ariaJs) {
    entries.push(`aria: ${ariaJs}`);
    elProps.push(`aria: ${ariaJs}`);
  }
  if (elProps.length > 0) {
    entries.push(`el: { ${elProps.join(", ")} }`);
  }
  return `{ ${entries.join(", ")} }`;
}
