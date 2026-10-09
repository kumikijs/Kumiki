import type { BindSegment, StyleDecl, TileNode, TileProps } from "./core.ts";
import {
  attrValue,
  bindLabel,
  commonAttrDecls,
  gridTracks,
  pickBaseValue,
  propStyleDecls,
} from "./core.ts";
import { headingTag } from "./tiles/text/heading.ts";

const VOID_TAGS = new Set(["br", "hr", "img", "input"]);

/** The spinner a loading button carries, as the renderer builds it. */
const BUTTON_SPINNER =
  '<span data-kumiki-tile="spinner" aria-hidden="true" style="margin-right: 0.4em"></span>';

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

function stringAttr(v: unknown): string | undefined {
  const value = attrValue(v);
  return value === undefined ? undefined : String(value);
}

function controlAttrs(
  props: TileProps | undefined,
  takesReadonly = false,
): Record<string, string | boolean | undefined> {
  return {
    disabled: props?.disabled === true ? true : undefined,
    // Only where the element has the state to be in: a `<select>` and a checkbox have no `readOnly`, and the mount path skips them by asking the element.
    // Serialising it anyway would put an attribute on the served page that hydration then takes away.
    readonly: takesReadonly && props?.readonly === true ? true : undefined,
    autocomplete: stringAttr(props?.auto_complete),
  };
}

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
      // silently — `ssr-parity.test.ts` is what notices, for the kinds it
      // covers.
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
function overlayLayerStyle(align: string): string {
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

function styleAttr(node: TileNode): string | undefined {
  const decls = [
    ...baseDecls(node),
    ...propStyleDecls((node as { props?: TileProps }).props, pickBaseValue, node.kind),
  ];
  if (decls.length === 0) return undefined;
  return decls.map(([k, v]) => `${k}: ${v}`).join("; ");
}

function tileIdOf(node: TileNode): string | undefined {
  const raw = (node as { id?: unknown }).id ?? (node as { props?: { id?: unknown } }).props?.id;
  const value = attrValue(raw);
  return value === undefined ? undefined : String(value);
}

function bindAttr(node: { bind?: string; bindPath?: BindSegment[] }): string | undefined {
  if (!node.bind) return undefined;
  return node.bindPath ? bindLabel(node.bind, node.bindPath) : node.bind;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function serializeAttrs(attrs: Record<string, string | number | boolean | undefined>): string {
  let out = "";
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false || v === null) continue;
    if (v === true) {
      out += ` ${k}`;
      continue;
    }
    out += ` ${k}="${escapeAttr(String(v))}"`;
  }
  return out;
}

function el(
  node: TileNode,
  tag: string,
  attrs: Record<string, string | number | boolean | undefined>,
  children: string,
): string {
  const attrStr = serializeAttrs({ style: styleAttr(node), ...attrs, ...commonAttrs(node) });
  if (VOID_TAGS.has(tag)) return `<${tag}${attrStr}>`;
  return `<${tag}${attrStr}>${children}</${tag}>`;
}

/** The common props of a node, in the shape `serializeAttrs` takes. */
function commonAttrs(node: TileNode): Record<string, string> {
  return Object.fromEntries(commonAttrDecls((node as { props?: TileProps }).props));
}

function renderChildren(children: TileNode[]): string {
  let out = "";
  for (const c of children) {
    if (c != null) out += renderTileToString(c);
  }
  return out;
}

export function renderTileToString(node: TileNode): string {
  switch (node.kind) {
    case "page":
    case "column":
    case "row":
    case "card":
    case "box":
      return el(node, "div", { "data-kumiki-tile": node.kind }, renderChildren(node.children));
    case "grid":
    case "stack":
    case "region":
    case "scroll":
    case "panel":
    case "fieldset":
      return el(node, "div", { "data-kumiki-tile": node.kind }, renderChildren(node.children));
    case "overlay": {
      // The z-axis: the first child stays in normal flow and every later one gets its own absolutely-positioned layer, placed by `align`.
      const align = typeof node.props?.align === "string" ? node.props.align : "center";
      const layer = overlayLayerStyle(align);
      const inner = node.children
        .filter((c): c is TileNode => c != null)
        .map((child, i) =>
          // The layer index counts the children that survive the filter, as the renderer's does: a `when` that renders nothing must not consume the base-layer slot.
          i === 0
            ? renderTileToString(child)
            : `<div data-kumiki-tile="overlay-layer" style="${layer}">${renderTileToString(child)}</div>`,
        )
        .join("");
      return el(node, "div", { "data-kumiki-tile": "overlay" }, inner);
    }
    case "heading":
      return el(
        node,
        headingTag(node.props?.level),
        { "data-kumiki-tile": "heading" },
        escapeText(node.text),
      );
    case "text":
      return el(node, "span", { "data-kumiki-tile": "text" }, escapeText(node.text));
    case "label":
      return el(
        node,
        "label",
        {
          "data-kumiki-tile": "label",
          // The renderer reads `for` off the props and sets `htmlFor`; without it a server-painted form has no label association until hydration.
          for: typeof node.props?.for === "string" ? node.props.for : undefined,
        },
        escapeText(node.text),
      );
    case "button": {
      const loading = node.props?.loading === true;
      const variant = node.props?.variant;
      return el(
        node,
        "button",
        {
          type: stringAttr(node.type),
          "data-kumiki-tile": "button",
          disabled: loading || node.props?.disabled === true,
          "aria-busy": loading ? "true" : undefined,
          "data-kumiki-variant": attrValue(variant),
          id: tileIdOf(node),
        },
        `${loading ? BUTTON_SPINNER : ""}${escapeText(node.text)}`,
      );
    }
    case "input": {
      const bind = bindAttr(node);
      return el(
        node,
        "input",
        {
          type: node.type ?? "text",
          value: node.value ?? "",
          placeholder: stringAttr(node.placeholder),
          required: node.required,
          id: tileIdOf(node),
          accept: stringAttr(node.accept),
          multiple: node.multiple,
          ...controlAttrs(node.props, true),
          "data-kumiki-tile": "input",
          "data-kumiki-bind": bind,
        },
        "",
      );
    }
    case "textarea": {
      const bind = bindAttr(node);
      return el(
        node,
        "textarea",
        {
          rows: node.rows ? node.rows : undefined,
          placeholder: stringAttr(node.placeholder),
          id: tileIdOf(node),
          ...controlAttrs(node.props, true),
          "data-kumiki-tile": "textarea",
          "data-kumiki-bind": bind,
        },
        escapeText(node.value ?? ""),
      );
    }
    case "check":
    case "switch": {
      const inner = serializeAttrs({
        type: "checkbox",
        checked: node.checked,
        ...controlAttrs(node.props, true),
        "data-kumiki-bind": bindAttr(node),
      });
      return el(
        node,
        "label",
        node.kind === "switch"
          ? { "data-kumiki-tile": "switch", role: "switch" }
          : { "data-kumiki-tile": "check" },
        `<input${inner}>`,
      );
    }
    case "radio": {
      const label = typeof node.props?.label === "string" ? node.props.label : "";
      const inner = serializeAttrs({
        type: "radio",
        name: node.group,
        value: node.value === undefined ? undefined : String(node.value),
        checked: node.selected,
        ...controlAttrs(node.props, true),
        "data-kumiki-bind": bindAttr(node),
      });
      return el(
        node,
        "label",
        { "data-kumiki-tile": "radio" },
        `<input${inner}>${label ? `<span>${escapeText(label)}</span>` : ""}`,
      );
    }
    case "select": {
      const bind = bindAttr(node);
      const opts = (node.options ?? [])
        .map(
          (o) =>
            `<option value="${escapeAttr(String(o.value))}"${
              o.value === node.value ? " selected" : ""
            }>${escapeText(String(o.label))}</option>`,
        )
        .join("");
      return el(
        node,
        "select",
        {
          "data-kumiki-tile": "select",
          "data-kumiki-bind": bind,
          id: tileIdOf(node),
          ...controlAttrs(node.props),
        },
        node.placeholder !== undefined
          ? `<option value="" disabled${node.value === undefined ? " selected" : ""}>${escapeText(node.placeholder)}</option>${opts}`
          : opts,
      );
    }
    case "slider": {
      const bind = bindAttr(node);
      return el(
        node,
        "input",
        {
          type: "range",
          value: node.value,
          min: node.min,
          max: node.max,
          step: node.step,
          ...controlAttrs(node.props, true),
          "data-kumiki-tile": "slider",
          "data-kumiki-bind": bind,
          id: tileIdOf(node),
        },
        "",
      );
    }
    case "form":
      return el(node, "form", { "data-kumiki-tile": "form" }, renderChildren(node.children));
    case "link": {
      const external = node.props?.external === true;
      return el(
        node,
        "a",
        {
          href: node.to,
          "data-kumiki-tile": "link",
          target: external ? "_blank" : undefined,
          rel: external ? "noopener noreferrer" : undefined,
        },
        escapeText(node.text),
      );
    }
    case "markdown": {
      const inner = (node.text ?? "")
        .split(/\n\s*\n/)
        .map((para) => `<p style="white-space: pre-wrap">${escapeText(para.trim())}</p>`)
        .join("");
      return el(node, "div", { "data-kumiki-tile": "markdown" }, inner);
    }
    case "image":
      // `alt` is read from the props, not hardcoded empty: a served page whose stated purpose is that a screen reader and a crawler see something is the last place to throw the alt text away.
      return el(
        node,
        "img",
        {
          src: node.src,
          "data-kumiki-tile": "image",
          alt: typeof node.props?.alt === "string" ? node.props.alt : undefined,
          // The box the image will occupy. Serving it is the whole point: an image with no dimensions moves everything below it when it loads.
          width: attrValue(node.props?.width),
          height: attrValue(node.props?.height),
          loading:
            node.props?.loading === "lazy" || node.props?.loading === "eager"
              ? node.props.loading
              : undefined,
          id: tileIdOf(node),
        },
        "",
      );
    case "icon": {
      return el(
        node,
        "span",
        { "data-kumiki-tile": "icon", "data-kumiki-icon-name": node.name },
        "",
      );
    }
    case "divider":
      return el(
        node,
        "hr",
        {
          "data-kumiki-tile": "divider",
          "aria-orientation": node.props?.orientation === "vertical" ? "vertical" : undefined,
        },
        "",
      );
    case "code":
      // `data-lang` belongs to the `<code>`, which is what the renderer marks and what its patcher reads.
      return el(
        node,
        "pre",
        { "data-kumiki-tile": "code" },
        `<code${serializeAttrs({ "data-lang": node.lang || undefined })}>${escapeText(node.text)}</code>`,
      );
    case "video":
      return el(
        node,
        "video",
        {
          src: stringAttr(node.src),
          controls: node.controls,
          autoplay: node.autoplay,
          "data-kumiki-tile": "video",
        },
        "",
      );
    case "list":
      return el(
        node,
        node.ordered ? "ol" : "ul",
        { "data-kumiki-tile": "list" },
        renderChildren(node.children),
      );
    case "list-item":
      return el(node, "li", { "data-kumiki-tile": "list-item" }, renderChildren(node.children));
    case "table":
      return el(node, "table", { "data-kumiki-tile": "table" }, renderChildren(node.children));
    case "table-head":
      return el(node, "thead", { "data-kumiki-tile": "table-head" }, renderChildren(node.children));
    case "table-body":
      return el(node, "tbody", { "data-kumiki-tile": "table-body" }, renderChildren(node.children));
    case "table-row":
      return el(node, "tr", { "data-kumiki-tile": "table-row" }, renderChildren(node.children));
    case "table-cell":
      return el(
        node,
        "td",
        {
          colspan: node.colspan ? node.colspan : undefined,
          rowspan: node.rowspan ? node.rowspan : undefined,
          "data-kumiki-tile": "table-cell",
        },
        renderChildren(node.children),
      );
    case "modal":
    case "drawer":
    case "popover": {
      const title = attrValue(node.title);
      const inner =
        `<div data-kumiki-tile="${node.kind}-content" style="background: #fff">` +
        `${title === undefined ? "" : `<h2>${escapeText(String(title))}</h2>`}` +
        `${renderChildren(node.children)}</div>`;
      return el(
        node,
        "div",
        {
          "data-kumiki-tile": node.kind,
          role: node.kind === "modal" ? "dialog" : undefined,
          "aria-label": title,
        },
        inner,
      );
    }
    case "tooltip":
      return el(
        node,
        "span",
        {
          "data-kumiki-tile": "tooltip",
          title: stringAttr(node.text),
          "data-placement": stringAttr(node.placement),
        },
        renderChildren(node.children),
      );
    case "toast":
      return el(
        node,
        "div",
        {
          "data-kumiki-tile": "toast",
          "data-level": stringAttr(node.level),
          role: "status",
          "aria-live": "polite",
        },
        escapeText(node.text ?? ""),
      );
    case "progress":
      return el(
        node,
        "progress",
        { value: node.value, max: node.max, "data-kumiki-tile": "progress" },
        "",
      );
    case "spinner":
      return el(
        node,
        "span",
        {
          "data-kumiki-tile": "spinner",
          role: "status",
          "aria-label": "Loading",
        },
        "",
      );
    case "skeleton":
      return el(node, "div", { "data-kumiki-tile": "skeleton", "aria-busy": "true" }, "");
    case "error":
      return el(
        node,
        "span",
        {
          "data-kumiki-tile": "error",
          "data-field": node.field,
          role: "alert",
          "aria-live": "assertive",
        },
        "",
      );
    case "route-outlet":
      return el(node, "div", { "data-kumiki-tile": "route-outlet" }, renderChildren(node.children));
    case "details": {
      const inner = `<summary>${escapeText(node.summary)}</summary>${renderChildren(node.children)}`;
      return el(node, "details", { "data-kumiki-tile": "details", open: node.open }, inner);
    }
    case "editable": {
      const bind = bindAttr(node);
      return el(
        node,
        "div",
        {
          "data-kumiki-tile": "editable",
          contenteditable:
            node.props?.disabled === true || node.props?.readonly === true ? "false" : "true",
          "data-kumiki-bind": bind,
        },
        escapeText(node.text ?? ""),
      );
    }
  }
}
