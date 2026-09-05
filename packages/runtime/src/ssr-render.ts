// SSR tile walker (docs/spec/runtime.md §10.6.1). Walks a `TileNode` tree and
// produces an HTML string — no DOM, no `happy-dom`, no `tiles-*.ts`. Each
// `tiles-*.ts` renderer is designed for the live mount path (handler attach,
// focus restoration, motion classes, `_setSlot` write-back), and reaching for
// one would drag a DOM in; the SSR pass only owns the first-byte HTML the
// client will hydrate over. That is what keeps the server side free of
// DOM-emulation deps, which the 30 KB bundle budget (§10.6.3) requires for Edge
// targets.
//
// What it does share with the renderers is the prop-to-style mapping, imported
// from `core.ts` as data (`propStyleDecls`, applied to every kind). `core.ts`
// touches no DOM at module scope — `ssr.ts` already imports values from it —
// and the alternative is a second copy of the mapping, which is exactly the
// drift the parity test exists to catch.

import type { BindSegment, StyleDecl, TileNode, TileProps } from "./core.ts";
import { attrValue, bindLabel, commonAttrDecls, pickBaseValue, propStyleDecls } from "./core.ts";

const VOID_TAGS = new Set(["br", "hr", "img", "input"]);

/** The spinner a loading button carries, as the renderer builds it. */
const BUTTON_SPINNER =
  '<span data-kumiki-tile="spinner" aria-hidden="true" style="margin-right: 0.4em"></span>';

/**
 * Stretching a positioned element over the box it is positioned against, as
 * the renderer writes it: the four longhands, not the `inset` shorthand. See
 * `coverParent` in `tiles-overlay.ts` for why the shorthand is the one
 * declaration neither path can rely on.
 */
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

/**
 * What a control's `disabled` / `readonly` / `auto-complete` serialise to. A
 * served form whose fields look enabled but are not is worse than one that
 * looks the way it will behave once the page hydrates.
 */
/**
 * `attrValue` where the attribute is a string, not a number — and the guard
 * every field a renderer writes under `if (field)` goes through. `serializeAttrs`
 * drops only `undefined` / `null` / `false`, so without this an empty `text` or
 * `placeholder` served `title=""` / `placeholder=""` where the mounted element
 * has no attribute at all.
 */
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
    // Only where the element has the state to be in: a `<select>` and a
    // checkbox have no `readOnly`, and the mount path skips them by asking the
    // element. Serialising it anyway would put an attribute on the served page
    // that hydration then takes away.
    readonly: takesReadonly && props?.readonly === true ? true : undefined,
    autocomplete: stringAttr(props?.auto_complete),
  };
}

/** `controlAttrs` for an `<input>` nested inside its own markup. */
function controlAttrString(props?: TileProps): string {
  return serializeAttrs(controlAttrs(props, true));
}

/**
 * What a kind paints of its own accord — `column`'s flex axis, `card`'s box
 * metrics, `grid`'s tracks — as opposed to what its props map to. Some of it
 * reads a prop (a `grid`'s `cols`, a `skeleton`'s `h`), which is why this is
 * "the kind's own layout" rather than "before it looks at props".
 *
 * It lives here rather than in a table the renderers also read, because the
 * renderers are the per-app DCE unit (#71) and a shared table would ship every
 * kind's base style to every app. What keeps the two copies honest is
 * `ssr-parity.test.ts`, which renders a node per kind both ways and compares.
 */
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
        // The default only applies when the tile did not ask for padding, the
        // same condition the renderer checks.
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
      const rows = gridTracks(node.props?.rows);
      return [
        ["display", "grid"],
        ["grid-template-columns", gridTracks(node.props?.cols) ?? "repeat(3, 1fr)"],
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
      // The colour is the whole of what says "this is an error" before the
      // theme stylesheet arrives, and it is the renderer's own, not a prop's.
      return [["color", "#c00"]];
    case "divider":
      // A vertical rule separates columns rather than rows: it takes its height
      // from the row it is in and draws on its left edge, an `<hr>`'s own
      // border being the horizontal one.
      return node.props?.orientation === "vertical" ? VERTICAL_DIVIDER_DECLS : [];
    default:
      // A kind whose renderer paints nothing of its own. New kinds land here
      // by default, so a renderer that starts painting a base style diverges
      // silently — `ssr-parity.test.ts` is what notices, for the kinds it
      // covers.
      return [];
  }
}

/**
 * What a `modal` / `drawer` / `popover` host paints, as its renderer does.
 *
 * A CLOSED surface is served as the same host, hidden — not as nothing. The
 * client mounts one either way so that opening a surface is a style flip
 * rather than a mount, and a server that emitted `""` for it served a crawler
 * a page with the dialog's content missing, and a first paint laid out as if
 * the surface were not there (spec/runtime.md §10.6.1). Not a hydration
 * argument: hydration replaces this DOM wholesale whatever shape it is in.
 */
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
  // A drawer / popover has no `display` of its own when it is open: the
  // renderer clears the property rather than naming a value, so the element
  // falls back to what the stylesheet computes for it.
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

/** A grid track list: a count divides the axis equally, a string is CSS already. */
function gridTracks(v: unknown): string | undefined {
  if (typeof v === "number") return `repeat(${v}, 1fr)`;
  if (typeof v === "string") return v;
  return undefined;
}

/**
 * The `style` attribute for a node: what its kind paints unconditionally, then
 * what its props add. `undefined` when there is nothing to say, so a tile with
 * no styling serialises without an empty attribute.
 *
 * Responsive values collapse to their base: a breakpoint is a viewport
 * question and the server has no viewport. The client agrees on every viewport
 * narrower than the first declared breakpoint, and re-styles on hydration
 * otherwise.
 */
function styleAttr(node: TileNode): string | undefined {
  const decls = [
    ...baseDecls(node),
    ...propStyleDecls((node as { props?: TileProps }).props, pickBaseValue, node.kind),
  ];
  if (decls.length === 0) return undefined;
  return decls.map(([k, v]) => `${k}: ${v}`).join("; ");
}

/**
 * The id a tile carries, from either form the renderers accept: a positional
 * argument (`input(id="x")`) or the props block (`{id: "x"}`). The server read
 * only the first, so a `label(for=…)` on a served page pointed at a control
 * with no id until the client gave it one.
 *
 * Through `attrValue`, so the empty string writes no attribute: it is what a
 * conditional's "not said" branch produces, and the renderers all gate on
 * `if (id)`. A served `id=""` is an id no `for=` can point at.
 */
function tileIdOf(node: TileNode): string | undefined {
  const raw = (node as { id?: unknown }).id ?? (node as { props?: { id?: unknown } }).props?.id;
  const value = attrValue(raw);
  return value === undefined ? undefined : String(value);
}

/**
 * The `data-kumiki-bind` marker, or nothing when the tile carries no bind. The
 * renderers write it under `if (node.bind)`, so a `bind=""` — the branch of a
 * conditional that binds nothing — has to write no attribute here either.
 */
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

/**
 * One element of the output. The node comes first because every kind owes the
 * same common attributes (`class`, `aria`, `test-id`, `role`) on top of what it
 * writes for itself — folding them in here is what stops a new kind from
 * quietly dropping them, and what makes the served attribute set the same one
 * `applyCommonProps` puts on the mounted element.
 *
 * The common attributes come last so a tile that asks for a `role` overrides
 * the one its kind assumes, exactly as on the client, where they are applied
 * after the renderer has run.
 */
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

/**
 * A child list, skipping the holes a conditional leaves. `when(cond, Tile())`
 * lowers to a child that is `null` on the false branch, and the mount path's
 * `appendChildren` filters for exactly that — a bare walk here throws on the
 * first one and takes the whole page's HTML with it.
 */
function renderChildren(children: TileNode[]): string {
  let out = "";
  for (const c of children) {
    if (c != null) out += renderTileToString(c);
  }
  return out;
}

/**
 * Serialise one `TileNode` (plus its descendants) to an HTML string.
 *
 * The output mirrors the live renderers: the same elements — the outer one and
 * whatever the renderer nests inside it — the same `data-kumiki-*` attributes,
 * and the same inline style, the kind's own layout plus whatever its props map
 * to (`propStyleDecls` in core, the very mapping the mount path applies to
 * every element). The style is the load-bearing half: without it the first
 * paint lays every flex container out as a block and the page reflows on
 * hydration, which is the shift SSR exists to remove.
 *
 * "Mirrors" is a claim about every kind in `TileNode["kind"]`, and
 * `ssr-parity.test.ts` is where it is made good: the table there is total over
 * the union and compares each kind's subtree, so a renderer that starts
 * painting something this file does not fails rather than drifts (#296).
 *
 * It omits what the client owns and an attribute cannot carry: event handlers,
 * focus state, the class-backed layers (`transition`, the `hover:` / `focus:`
 * / `active:` blocks, motion), everything the theme stylesheet paints (a
 * `card`'s surface and shadow, the control rings) because the client injects
 * those rules at mount, and the resolved `icon` SVG — the placeholder is the
 * renderer's own element under the renderer's own attribute, but empty until
 * the path resolves. Nor is a live-resolved message: an `error` tile is served
 * as the `<span>` it will arrive in, empty. A responsive value collapses to
 * its base, because a breakpoint is a question about a viewport the server
 * does not have. The client mount replaces this DOM wholesale on its first
 * `render()` after hydration — node identity is NOT preserved on purpose.
 */
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
      // The z-axis: the first child stays in normal flow and every later one
      // gets its own absolutely-positioned layer, placed by `align`. Served
      // flat, every layer is in flow and the first paint is a column — the
      // stack appears only once the client has rendered.
      const align = typeof node.props?.align === "string" ? node.props.align : "center";
      const layer = overlayLayerStyle(align);
      const inner = node.children
        .filter((c): c is TileNode => c != null)
        .map((child, i) =>
          // The layer index counts the children that survive the filter, as the
          // renderer's does: a `when` that renders nothing must not consume the
          // base-layer slot.
          i === 0
            ? renderTileToString(child)
            : `<div data-kumiki-tile="overlay-layer" style="${layer}">${renderTileToString(child)}</div>`,
        )
        .join("");
      return el(node, "div", { "data-kumiki-tile": "overlay" }, inner);
    }
    case "heading":
      return el(node, "h1", { "data-kumiki-tile": "heading" }, escapeText(node.text));
    case "text":
      return el(node, "span", { "data-kumiki-tile": "text" }, escapeText(node.text));
    case "label":
      return el(
        node,
        "label",
        {
          "data-kumiki-tile": "label",
          // The renderer reads `for` off the props and sets `htmlFor`; without
          // it a server-painted form has no label association until hydration.
          for: typeof node.props?.for === "string" ? node.props.for : undefined,
        },
        escapeText(node.text),
      );
    case "button": {
      // `loading` disables the button and puts a spinner in front of its
      // label, the same two things the renderer does — a served button that
      // looked idle while its work was in flight is clickable to a user who
      // has not hydrated yet.
      const loading = node.props?.loading === true;
      const variant = node.props?.variant;
      return el(
        node,
        "button",
        {
          // What the tile said, or nothing — the same choice the client
          // renderer makes. Writing `button` here regardless meant the served
          // HTML did not submit and the hydrated page did.
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
      // The wrapping <label> is the element the mount path builds and the one
      // the common props land on, so it is the element hydration has to meet.
      return el(
        node,
        "label",
        { "data-kumiki-tile": "check" },
        `<input type="checkbox"${node.checked ? " checked" : ""}${controlAttrString(node.props)}>`,
      );
    case "switch":
      return el(
        node,
        "label",
        { "data-kumiki-tile": "switch", role: "switch" },
        `<input type="checkbox"${node.checked ? " checked" : ""}${controlAttrString(node.props)}>`,
      );
    case "radio": {
      const label = typeof node.props?.label === "string" ? node.props.label : "";
      const inner = serializeAttrs({
        type: "radio",
        name: node.group,
        value: node.value === undefined ? undefined : String(node.value),
        checked: node.selected,
        ...controlAttrs(node.props, true),
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
      // The same minimal markdown the renderer parses — a paragraph per blank
      // line, `pre-wrap` so the single breaks inside one survive. Served as
      // one text node instead, the first paint ran every line of the document
      // together into a single block, and so did what a crawler read.
      const inner = (node.text ?? "")
        .split(/\n\s*\n/)
        .map((para) => `<p style="white-space: pre-wrap">${escapeText(para.trim())}</p>`)
        .join("");
      return el(node, "div", { "data-kumiki-tile": "markdown" }, inner);
    }
    case "image":
      // `alt` is read from the props, not hardcoded empty: a served page whose
      // stated purpose is that a screen reader and a crawler see something is
      // the last place to throw the alt text away.
      return el(
        node,
        "img",
        {
          src: node.src,
          "data-kumiki-tile": "image",
          alt: typeof node.props?.alt === "string" ? node.props.alt : undefined,
          // The box the image will occupy. Serving it is the whole point: an
          // image with no dimensions moves everything below it when it loads.
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
      // Placeholder — the client renderer resolves the icon name against
      // `app.icons` and injects a real SVG path. Under the same attribute the
      // client writes, so hydration meets one element rather than two; it is
      // still empty and unsized until the path arrives, which does move what
      // follows it.
      //
      // `size` sizes the SVG box; it also lands on the span as a `font-size`,
      // on both paths, where it is inert against a sized `<svg>`.
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
      // `data-lang` belongs to the `<code>`, which is what the renderer marks
      // and what its patcher reads.
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
      // A closed surface is served as the host the renderer builds, hidden —
      // see `surfaceDecls`. The content box is its own element on the client
      // and the title is an `<h2>` inside it, so serving the children bare put
      // them in a box that paints differently. Focus and the close handler
      // stay client-side.
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
      // Field-bound error messages depend on live refinement results — empty
      // on the server, the client renders the actual error on first render.
      // The element is the renderer's `<span>`: a served `<div>` reserved a
      // block where the client paints an inline box, so the message's arrival
      // moved what sat beside it.
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
      // Native <details> disclosure. SSR emits the current open state via
      // the `open` attribute so the server-painted collapse matches what
      // the client renders on hydration; children still emit inside so a
      // no-JS user (or search crawler) can read the content.
      const inner = `<summary>${escapeText(node.summary)}</summary>${renderChildren(node.children)}`;
      return el(node, "details", { "data-kumiki-tile": "details", open: node.open }, inner);
    }
    case "editable": {
      // contenteditable div. `bind=`, if present, becomes `data-kumiki-bind`
      // so the client picks up the same identity path used by input /
      // textarea. The initial text is escaped verbatim; caret / selection
      // state is a client-only concern.
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
