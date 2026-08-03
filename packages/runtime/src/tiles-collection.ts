// Collection tile renderers (#71): list and table families.

import {
  applyContainerProps,
  PatchRequiresRebuild,
  type TileCtx,
  type TileNode,
  type TilePatchers,
  type TileRenderers,
} from "./core.ts";

type Node<K extends TileNode["kind"]> = TileNode & { kind: K };

function appendChildren(el: HTMLElement, children: TileNode[], ctx: TileCtx): void {
  for (const child of children) {
    if (child != null) el.appendChild(ctx.render(child));
  }
}

function renderTablePart(
  node: Node<"table" | "table-head" | "table-body" | "table-row">,
  ctx: TileCtx,
): HTMLElement {
  const tag = {
    table: "table",
    "table-head": "thead",
    "table-body": "tbody",
    "table-row": "tr",
  }[node.kind] as string;
  const el = document.createElement(tag);
  el.dataset.kumikiTile = node.kind;
  appendChildren(el, node.children, ctx);
  return el;
}

export const collectionTiles: TileRenderers = {
  list(node, ctx) {
    const list = document.createElement(node.ordered ? "ol" : "ul");
    list.dataset.kumikiTile = "list";
    applyContainerProps(list, node.props);
    appendChildren(list, node.children, ctx);
    return list;
  },
  "list-item"(node, ctx) {
    const li = document.createElement("li");
    li.dataset.kumikiTile = "list-item";
    appendChildren(li, node.children, ctx);
    return li;
  },
  table: renderTablePart,
  "table-head": renderTablePart,
  "table-body": renderTablePart,
  "table-row": renderTablePart,
  "table-cell"(node, ctx) {
    const td = document.createElement("td");
    td.dataset.kumikiTile = "table-cell";
    if (node.colspan) td.colSpan = node.colspan;
    if (node.rowspan) td.rowSpan = node.rowspan;
    appendChildren(td, node.children, ctx);
    return td;
  },
};

export const collectionPatchers: TilePatchers = {
  list(el, _oldNode, newNode) {
    // `list` renders `<ol>` or `<ul>` based on `ordered`; a change flips the
    // tag, and a same-kind patch cannot rewrite an element's tagName. Signal
    // the reconcile to fall back to a same-kind rebuild via the controlled
    // `PatchRequiresRebuild` sentinel — this stays out of the panic log (it
    // is a normal outcome for a legitimate authored change), unlike a raw
    // `throw` which the outer bailout would record as `location: "reconcile"`.
    const list = el as HTMLUListElement | HTMLOListElement;
    const wantTag = newNode.ordered ? "OL" : "UL";
    if (list.tagName !== wantTag) {
      throw new PatchRequiresRebuild(`list "ordered" flipped (${list.tagName} → ${wantTag})`);
    }
    applyContainerProps(list, newNode.props);
  },
  "list-item"() {
    // <li> has no own data props; children walk via the outer reconcile.
  },
  table() {},
  "table-head"() {},
  "table-body"() {},
  "table-row"() {},
  "table-cell"(el, _oldNode, newNode) {
    const td = el as HTMLTableCellElement;
    const nextCol = newNode.colspan ?? 1;
    if (td.colSpan !== nextCol) td.colSpan = nextCol;
    const nextRow = newNode.rowspan ?? 1;
    if (td.rowSpan !== nextRow) td.rowSpan = nextRow;
  },
};
