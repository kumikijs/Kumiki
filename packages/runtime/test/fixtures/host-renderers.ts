// Host tile renderers that deliberately break one of the contracts the
// reconcile walker relies on. Shared because more than one suite asserts about
// the SAME renderer: a copy per file can drift into testing a different shape
// while both stay green.

import type { TileCtx, TileNode } from "@kumikijs/runtime";

/**
 * A `column` renderer that maps only its FIRST child through `ctx.render` and
 * hand-builds the rest — the compat shape that leaves later children out of
 * the node → element map (`ctx.render` is what records it).
 *
 * The positional walk therefore pairs index 0 successfully and finds nothing
 * to pair index 1 against, which is `child-unmapped` at index 1: a bail with a
 * sibling ahead of it that would otherwise have reconciled.
 */
export function firstChildMappedColumn(node: TileNode, ctx: TileCtx): HTMLElement {
  const el = document.createElement("div");
  const children = (node as { children?: TileNode[] }).children ?? [];
  children.forEach((child, i) => {
    if (i === 0) {
      el.appendChild(ctx.render(child));
      return;
    }
    const span = document.createElement("span");
    span.textContent = (child as { text?: string }).text ?? "";
    el.appendChild(span);
  });
  return el;
}
