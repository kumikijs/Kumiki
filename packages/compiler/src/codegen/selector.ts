import { type Expr, isTileExpr, type TileExpr, type UiEventKind } from "../ast.ts";
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

export function propsFor(
  t: TileExpr & { kind: "TileCall" },
  ctx: EvalCtx,
  // Every user tile this call renders under, outermost first — a selector
  // naming any of them reaches this node. See `EnclosingTiles`.
  enclosingTiles?: EnclosingTiles,
): string {
  const entries: string[] = [];
  // `{aria: {...}}` and `{aria-label: "…"}` are one channel by the time they
  // reach the runtime — see `mergedAria`.
  const aria: AriaParts = { map: null, direct: [] };
  // Capture explicit event-handler wirings (`onClick=foo`, `{onClick: foo}`)
  // by handler name. They are flushed below alongside implicit (tile, ui-event)
  // subscribers as one chained dispatch handler, so spec §1.6.4 (every matching
  // reducer fires in definition order) holds even when explicit and implicit
  // both target the same handler.
  const explicitByHandler = new Map<string, string[]>();
  // Whatever shape the parser gave the name — a reference, a variant tag, an
  // argument-less tile call — `handlerReducerName` reads the reducer out of
  // it, the same one the checker resolved. Deciding here on `kind === "Ref"`
  // instead is what left a capitalised reducer name rejected by the checker
  // and wired by nobody.
  const recordExplicit = (handlerName: string, value: Expr | TileExpr): void => {
    const reducerName = handlerReducerName(value);
    if (reducerName === null) return;
    const list = explicitByHandler.get(handlerName) ?? [];
    list.push(reducerName);
    explicitByHandler.set(handlerName, list);
  };

  // event handler args (onClick=remove etc) attach as props for that tile.
  for (const a of t.args) {
    if (!a.name) continue;
    if (HANDLER_NAMES.has(a.name)) recordExplicit(a.name, a.value);
  }
  // props block
  for (const p of t.props) {
    if (HANDLER_NAMES.has(p.name)) {
      recordExplicit(p.name, p.value);
      continue;
    }
    if (isNotPropData(t.name, p.name)) continue;
    if (collectAria(p.name, () => jsOfExpr(p.value, ctx), aria)) continue;
    entries.push(`${jsProperty(p.name)}: ${jsOfExpr(p.value, ctx)}`);
  }

  // Combine explicit wirings with reducers subscribing to (an enclosing tile, ev)
  // into a single chained handler. Explicit first (declared on the tile that
  // mounts the element), then implicit subscribers in their source order — so
  // adding a `reducer foo on=ui.click(B)` never silently shadows an existing
  // `onClick=bar` on `B`, and vice versa. Same-reducer overlap (e.g. both
  // `onClick=inc` and `reducer inc on=ui.click(B)` naming `inc`) deduplicates
  // by reducer name so the user's `inc` doesn't fire twice per click.
  const emittedHandlers = new Set<string>();
  const pushHandler = (ev: UiEventKind | null, handlerName: string): void => {
    const explicit = explicitByHandler.get(handlerName) ?? [];
    // Filtered out of `gen.reducers` rather than gathered per enclosing tile,
    // so several ancestors subscribing to one event still fire in DEFINITION
    // order (§1.6.4) instead of in innermost-first order.
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
    const seen = new Set<string>();
    const names = [...explicit, ...implicit].filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
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
    entries.push(`${handlerName}: ${handlerRef(names)}`);
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
