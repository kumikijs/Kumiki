import {
  gridTracks,
  pickBaseValue,
  propStyleDecls,
  type StyleDecl,
  type TileNode,
  type TileProps,
} from "../core.ts";

const COVER_PARENT: StyleDecl[] = [
  ["top", "0"],
  ["right", "0"],
  ["bottom", "0"],
  ["left", "0"],
];

/** What makes an `<hr>` vertical, as the renderer sets it. */
const VERTICAL_DIVIDER_DECLS: StyleDecl[] = [
  ["align-self", "stretch"],
  ["width", "0"],
  ["height", "auto"],
  ["border-top", "none"],
  ["border-left", "1px solid currentColor"],
];

function baseDecls(node: TileNode): StyleDecl[] {
  switch (node.kind) {
    case "page":
    case "column":
    case "stack":
      return [
        ["display", "flex"],
        ["flex-direction", "column"],
      ];
    case "row":
      return [
        ["display", "flex"],
        ["flex-direction", "row"],
      ];
    case "card":
      return [
        // The default only applies when the tile did not ask for padding, the same condition the renderer checks.
        ...(node.props?.pad === undefined ? ([["padding", "16px"]] as StyleDecl[]) : []),
        ["margin-bottom", "12px"],
        ["border-radius", "8px"],
      ];
    case "scroll":
      return [["overflow", "auto"]];
    case "skeleton": {
      const h = node.props?.h;
      return [
        ["background", "#eee"],
        ["border-radius", "8px"],
        ["min-height", "60px"],
        ...(typeof h === "number" ? ([["height", `${h}px`]] as StyleDecl[]) : []),
      ];
    }
    case "spinner": {
      const size = node.props?.size;
      const token =
        typeof size === "string"
          ? { sm: "0.75rem", md: "1rem", lg: "1.5rem", xl: "2rem" }[size]
          : undefined;
      return token ? [["font-size", token]] : [];
    }
    case "grid": {
      const { cols, rows } = gridTracks(node.props, pickBaseValue);
      return [
        ["display", "grid"],
        ["grid-template-columns", cols],
        ...(rows ? ([["grid-template-rows", rows]] as StyleDecl[]) : []),
      ];
    }
    case "overlay":
      return [["position", "relative"]];
    case "modal":
    case "drawer":
    case "popover":
      return surfaceDecls(node.kind, node.open, node.side);
    case "toast":
      return [
        ["padding", "8px 12px"],
        ["border-radius", "6px"],
      ];
    case "error":
      // The colour is the whole of what says "this is an error" before the theme stylesheet arrives, and it is the renderer's own, not a prop's.
      return [["color", "#c00"]];
    case "divider":
      // A vertical rule separates columns rather than rows: it takes its height from the row it is in and draws on its left edge, an `<hr>`'s own border being the horizontal one.
      return node.props?.orientation === "vertical" ? VERTICAL_DIVIDER_DECLS : [];
    default:
      // A kind whose renderer paints nothing of its own. New kinds land here
      // by default, so a renderer that starts painting a base style diverges
      // silently — the SSR parity tests are what notice, for the kinds they
      // cover.
      return [];
  }
}

function surfaceDecls(
  kind: "modal" | "drawer" | "popover",
  open: boolean | undefined,
  side: string | undefined,
): StyleDecl[] {
  const closed = open === false;
  if (kind === "modal") {
    return [
      ["display", closed ? "none" : "flex"],
      ["position", "fixed"],
      ...COVER_PARENT,
      ["align-items", "center"],
      ["justify-content", "center"],
      ["background", "rgba(0,0,0,0.4)"],
    ];
  }
  // A drawer / popover has no `display` of its own when it is open: the renderer clears the property rather than naming a value, so the element falls back to what the stylesheet computes for it.
  const hidden: StyleDecl[] = closed ? [["display", "none"]] : [];
  if (kind === "drawer") {
    return [
      ...hidden,
      ["position", "fixed"],
      ["top", "0"],
      ["bottom", "0"],
      [side === "right" ? "right" : "left", "0"],
    ];
  }
  return hidden;
}

/** The absolutely-positioned layer an `overlay` wraps each child after the first in. */
export function overlayLayerStyle(align: string): string {
  const parts = align.split("-");
  const has = (k: string): boolean => parts.includes(k);
  const decls: StyleDecl[] = [
    ["position", "absolute"],
    ...COVER_PARENT,
    ["display", "flex"],
    ["align-items", has("top") ? "flex-start" : has("bottom") ? "flex-end" : "center"],
    ["justify-content", has("left") ? "flex-start" : has("right") ? "flex-end" : "center"],
  ];
  return decls.map(([k, v]) => `${k}: ${v}`).join("; ");
}

export function styleAttr(node: TileNode): string | undefined {
  const decls = [
    ...baseDecls(node),
    ...propStyleDecls((node as { props?: TileProps }).props, pickBaseValue, node.kind),
  ];
  if (decls.length === 0) return undefined;
  return decls.map(([k, v]) => `${k}: ${v}`).join("; ");
}
