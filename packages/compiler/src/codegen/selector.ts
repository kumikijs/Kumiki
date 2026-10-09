import { isTileExpr, type TileExpr, type UiEventKind } from "../ast.ts";
import { HANDLER_NAMES, handlerReducerName, UI_LIFTS } from "../ui-lifts.ts";
import { type EnclosingTiles, type EvalCtx, fieldKey, handlerRef, jsProperty } from "./context.ts";
import { jsOfExpr } from "./expr.ts";

export function keyFor(t: TileExpr & { kind: "TileCall" }, ctx: EvalCtx): string | null {
  const keyProp = t.props.find((p) => p.name === "key");
  if (!keyProp) return null;
  return `_s.show(${jsOfExpr(keyProp.value, ctx)})`;
}

function isNotPropData(tile: string, name: string, forEl = false): boolean {
  if (HANDLER_NAMES.has(name)) return true;
  if (name === "key") return true;
  if (tile === "link" && (name === "prefetch" || name === "prefetch-args")) return true;
  if (forEl && name === "style") return true;
  if (forEl && name === "bind") return true;
  return false;
}

/** The ARIA a tile asked for: the `aria` map, plus each `aria-*` written on its own. */
type AriaParts = { map: string | null; direct: Array<[attr: string, js: string]> };

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

export type HandlerWiring = ReadonlyMap<string, readonly string[]>;

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

function inDefinitionOrder(names: readonly string[], ctx: EvalCtx): string[] {
  const rank = new Map<string, number>();
  ctx.gen.reducers.forEach((r, i) => {
    if (!rank.has(r.name)) rank.set(r.name, i);
  });
  const at = (n: string): number => rank.get(n) ?? Number.MAX_SAFE_INTEGER;
  return [...new Set(names)].sort((a, b) => at(a) - at(b));
}

export function propsFor(
  t: TileExpr & { kind: "TileCall" },
  ctx: EvalCtx,
  enclosingTiles?: EnclosingTiles,
  explicitByHandler: HandlerWiring = explicitHandlers(t),
): string {
  const entries: string[] = [];
  const aria: AriaParts = { map: null, direct: [] };

  const block = ctx.gen.expectedTree ? [] : t.props;
  for (const p of block) {
    if (HANDLER_NAMES.has(p.name)) continue;
    if (isNotPropData(t.name, p.name)) continue;
    if (collectAria(p.name, () => jsOfExpr(p.value, ctx), aria)) continue;
    entries.push(`${jsProperty(p.name)}: ${jsOfExpr(p.value, ctx)}`);
  }

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
    entries.push(`${handlerName}: ${handlerRef(names)}`);
    emittedHandlers.add(handlerName);
  };
  for (const lift of UI_LIFTS) {
    if (lift.tiles !== null && !lift.tiles.has(t.name)) continue;
    pushHandler(lift.ev, lift.handler);
  }
  for (const [handlerName, names] of explicitByHandler) {
    if (emittedHandlers.has(handlerName)) continue;
    entries.push(`${handlerName}: ${handlerRef(inDefinitionOrder(names, ctx))}`);
  }
  // Build `el` from explicit {name: expr} that aren't handlers
  const elProps: string[] = [];
  for (const p of block) {
    if (isNotPropData(t.name, p.name, true)) continue;
    if (p.name === "aria" || p.name.startsWith("aria-")) continue;
    elProps.push(`${fieldKey(p.name)}: ${jsOfExpr(p.value, ctx)}`);
  }
  const written = new Set(block.map((p) => p.name));
  for (const a of t.args) {
    if (!a.name || written.has(a.name)) continue;
    if (isNotPropData(t.name, a.name, true)) continue;
    if (isTileExpr(a.value)) continue;
    const js = jsOfExpr(a.value, ctx);
    if (collectAria(a.name, () => js, aria)) continue;
    entries.push(`${jsProperty(a.name)}: ${js}`);
    elProps.push(`${fieldKey(a.name)}: ${js}`);
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
