import { applyMotion } from "./motion.ts";
import { applyCommonProps, pickForViewport, propStyleDecls, setDecls } from "./style.ts";
import type { TileCtx, TileNode, TileRenderers } from "./types.ts";
import { applyUiEventHandlers } from "./ui-events.ts";

export type TileElementMap = WeakMap<TileNode, HTMLElement>;

/** A render context that records which element each tile node became, for the next reconcile. */
export function makeMappingTileCtx(tiles: TileRenderers, map: TileElementMap): TileCtx {
  const lookup = tiles as Record<
    string,
    ((node: TileNode, ctx: TileCtx) => HTMLElement) | undefined
  >;
  const ctx: TileCtx = {
    render(node: TileNode): HTMLElement {
      const renderer = lookup[node.kind];
      const el = renderer ? renderer(node, ctx) : renderMissingTile(node);
      applyMotion(el, node.props);
      applyUiEventHandlers(el, node.props);
      applyCommonProps(el, node.props);
      setDecls(el, propStyleDecls(node.props, pickForViewport, node.kind));
      map.set(node, el);
      return el;
    },
  };
  return ctx;
}

function renderMissingTile(node: TileNode): HTMLElement {
  console.error(`[kumiki] no renderer registered for tile kind "${node.kind}"`);
  const span = document.createElement("span");
  span.dataset.kumikiTile = node.kind;
  const text = (node as { text?: unknown }).text;
  if (text !== undefined) span.textContent = String(text);
  return span;
}
