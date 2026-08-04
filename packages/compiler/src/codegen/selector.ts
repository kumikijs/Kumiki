import type { Expr, TileExpr, UiEventKind } from "../ast.ts";
import { HANDLER_NAMES, UI_LIFTS } from "../ui-lifts.ts";
import { type EvalCtx, jsProperty } from "./context.ts";
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

export function propsFor(
  t: TileExpr & { kind: "TileCall" },
  ctx: EvalCtx,
  enclosingTile?: string,
): string {
  const entries: string[] = [];
  // Capture explicit event-handler wirings (`onClick=foo`, `{onClick: foo}`)
  // by handler name. They are flushed below alongside implicit (tile, ui-event)
  // subscribers as one chained dispatch handler, so spec §1.6.4 (every matching
  // reducer fires in definition order) holds even when explicit and implicit
  // both target the same handler.
  const explicitByHandler = new Map<string, string[]>();
  const recordExplicit = (handlerName: string, value: Expr): void => {
    if (value.kind !== "Ref") return;
    const reducerName = (value as Expr & { name: string }).name;
    const list = explicitByHandler.get(handlerName) ?? [];
    list.push(reducerName);
    explicitByHandler.set(handlerName, list);
  };

  // event handler args (onClick=remove etc) attach as props for that tile.
  for (const a of t.args) {
    if (!a.name) continue;
    if (HANDLER_NAMES.has(a.name)) recordExplicit(a.name, a.value as Expr);
  }
  // props block
  for (const p of t.props) {
    if (HANDLER_NAMES.has(p.name)) {
      recordExplicit(p.name, p.value as Expr);
      continue;
    }
    // §3.8 link prefetch — the link tile lifts these into top-level fields, so
    // do not also echo them through `props` (the bare-ident `prefetch: foo`
    // value would otherwise emit as a JS variable reference at codegen).
    if (t.name === "link" && (p.name === "prefetch" || p.name === "prefetch-args")) continue;
    // `key` is lifted to the TileNode's top level by `_wk` at the tile-call
    // boundary; it must not also flow into `props` or `el`.
    if (p.name === "key") continue;
    entries.push(`${jsProperty(p.name)}: ${jsOfExpr(p.value, ctx)}`);
  }

  // Combine explicit wirings with reducers subscribing to (enclosingTile, ev)
  // into a single chained handler. Explicit first (declared on the tile that
  // mounts the element), then implicit subscribers in their source order — so
  // adding a `reducer foo on=ui.click(B)` never silently shadows an existing
  // `onClick=bar` on `B`, and vice versa. Same-reducer overlap (e.g. both
  // `onClick=inc` and `reducer inc on=ui.click(B)` naming `inc`) deduplicates
  // by reducer name so the user's `inc` doesn't fire twice per click.
  const emittedHandlers = new Set<string>();
  const pushHandler = (ev: UiEventKind | null, handlerName: string): void => {
    const explicit = explicitByHandler.get(handlerName) ?? [];
    const implicit: string[] =
      ev !== null && enclosingTile
        ? ctx.gen.reducers
            .filter(
              (rr) =>
                rr.on.kind === "UiEvent" &&
                rr.on.ev === ev &&
                rr.on.selector.tile === enclosingTile,
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
    // Dispatch through the enclosing `createApp()` scope's own `App` (a lazy
    // reference — tiles are emitted inside `() =>` thunks that run after the
    // instance exists), so several compiled apps on one page never cross-wire
    // through a shared global.
    const body = names.map((n) => `App._dispatch(${JSON.stringify(n)}, el)`).join("; ");
    entries.push(`${handlerName}: (el) => { ${body} }`);
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
    const body = names.map((n) => `App._dispatch(${JSON.stringify(n)}, el)`).join("; ");
    entries.push(`${handlerName}: (el) => { ${body} }`);
  }
  // Build `el` from explicit {name: expr} that aren't handlers
  const elProps: string[] = [];
  for (const p of t.props) {
    if (HANDLER_NAMES.has(p.name)) continue;
    // §3.8 link prefetch — these are runtime-side fields, not slot data; their
    // value space (reducer-name ident / argument record) doesn't belong in `el`.
    if (t.name === "link" && (p.name === "prefetch" || p.name === "prefetch-args")) continue;
    // §4.3 style block — a CSS prop bag the runtime applies to el.style. It's
    // not reducer data, and shipping it twice (top-level + el) re-evaluates
    // every `@token` ref needlessly.
    if (p.name === "style") continue;
    // See the `key` note in the top-level props loop above.
    if (p.name === "key") continue;
    elProps.push(`${jsProperty(p.name)}: ${jsOfExpr(p.value, ctx)}`);
  }
  // §1.6.2 — the `id` prop drives `TileName#id` selector matching at dispatch
  // time via the `el.id` payload. Tiles that lift `id` from positional args
  // (input, textarea) bury it inside the tile node, so without this fold a
  // reducer scoped to `Foo#bar` would never fire for `input(id="bar")` even
  // though the DOM element has `id="bar"`. Block-style `{id: "..."}` already
  // lands in `elProps` via the loop above; we only fill the gap for args.
  const hasIdAlready = elProps.some((s) => s.startsWith("id:"));
  if (!hasIdAlready) {
    const idArg = t.args.find((a) => a.name === "id");
    if (idArg) elProps.push(`id: ${jsOfExpr(idArg.value as Expr, ctx)}`);
  }
  if (elProps.length > 0) {
    entries.push(`el: { ${elProps.join(", ")} }`);
  }
  return `{ ${entries.join(", ")} }`;
}
