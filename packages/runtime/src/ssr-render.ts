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
// from `core.ts` as data (`containerStyleDecls` / `textStyleDecls`). `core.ts`
// touches no DOM at module scope — `ssr.ts` already imports values from it —
// and the alternative is a second copy of the mapping, which is exactly the
// drift the parity test exists to catch.

import type { StyleDecl, TileNode, TileProps } from "./core.ts";
import { containerStyleDecls, pickBaseValue, textStyleDecls } from "./core.ts";

const VOID_TAGS = new Set(["br", "hr", "img", "input"]);

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
      const cols = node.props?.cols;
      return [
        ["display", "grid"],
        [
          "grid-template-columns",
          typeof cols === "number"
            ? `repeat(${cols}, 1fr)`
            : typeof cols === "string"
              ? cols
              : "repeat(3, 1fr)",
        ],
      ];
    }
    case "overlay":
      return [["position", "relative"]];
    default:
      // A kind whose renderer paints nothing of its own. New kinds land here
      // by default, so a renderer that starts painting a base style diverges
      // silently — `ssr-parity.test.ts` is what notices, for the kinds it
      // covers.
      return [];
  }
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
function styleAttr(node: TileNode, propDecls: StyleDecl[]): string | undefined {
  const decls = [...baseDecls(node), ...propDecls];
  if (decls.length === 0) return undefined;
  return decls.map(([k, v]) => `${k}: ${v}`).join("; ");
}

/** The style attribute of a container tile — base plus container props. */
function containerStyle(node: TileNode & { props?: TileProps }): string | undefined {
  return styleAttr(node, containerStyleDecls(node.props, pickBaseValue));
}

/**
 * The id a tile carries, from either form the renderers accept: a positional
 * argument (`input(id="x")`) or the props block (`{id: "x"}`). The server read
 * only the first, so a `label(for=…)` on a served page pointed at a control
 * with no id until hydration gave it one.
 */
function tileIdOf(node: TileNode): string | undefined {
  const raw = (node as { id?: unknown }).id ?? (node as { props?: { id?: unknown } }).props?.id;
  return raw == null ? undefined : String(raw);
}

/** The style attribute of a text tile — text props only; no kind paints a base. */
function textStyle(node: TileNode & { props?: TileProps }): string | undefined {
  return styleAttr(node, textStyleDecls(node.props));
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
  tag: string,
  attrs: Record<string, string | number | boolean | undefined>,
  children: string,
): string {
  const attrStr = serializeAttrs(attrs);
  if (VOID_TAGS.has(tag)) return `<${tag}${attrStr}>`;
  return `<${tag}${attrStr}>${children}</${tag}>`;
}

function renderChildren(children: TileNode[]): string {
  let out = "";
  for (const c of children) out += renderTileToString(c);
  return out;
}

/**
 * Serialise one `TileNode` (plus its descendants) to an HTML string.
 *
 * The output mirrors the live renderers: same outer element, same
 * `data-kumiki-*` attributes, and the same inline style — the kind's own
 * layout plus whatever its props map to (`containerStyleDecls` /
 * `textStyleDecls` in core, the very functions the renderers apply). The style
 * is the load-bearing half: without it the first paint lays every flex
 * container out as a block and the page reflows on hydration, which is the
 * shift SSR exists to remove.
 *
 * It omits what the client owns and an attribute cannot carry: event handlers,
 * focus state, the class-backed layers (`transition`, the `hover:` / `focus:`
 * / `active:` blocks, motion), everything the theme stylesheet paints (a
 * `card`'s surface and shadow, the control rings) because the client injects
 * those rules at mount, and the resolved `icon` SVG — the placeholder is the
 * renderer's own element under the renderer's own attribute, but empty until
 * the path resolves. A responsive value collapses to its
 * base, because a breakpoint is a question about a viewport the server does
 * not have. The client mount replaces this DOM wholesale on its first
 * `render()` after hydration — node identity is NOT preserved on purpose.
 */
export function renderTileToString(node: TileNode): string {
  switch (node.kind) {
    case "page":
    case "column":
    case "row":
    case "card":
    case "box":
      return el(
        "div",
        { "data-kumiki-tile": node.kind, style: containerStyle(node) },
        renderChildren(node.children),
      );
    case "grid":
    case "stack":
    case "region":
    case "scroll":
    case "panel":
    case "fieldset":
    case "overlay":
      return el(
        "div",
        { "data-kumiki-tile": node.kind, style: containerStyle(node) },
        renderChildren(node.children),
      );
    case "heading":
      return el(
        "h1",
        { "data-kumiki-tile": "heading", style: textStyle(node) },
        escapeText(node.text),
      );
    case "text":
      return el(
        "span",
        { "data-kumiki-tile": "text", style: textStyle(node) },
        escapeText(node.text),
      );
    case "label":
      return el(
        "label",
        {
          "data-kumiki-tile": "label",
          // The renderer reads `for` off the props and sets `htmlFor`; without
          // it a server-painted form has no label association until hydration.
          for: typeof node.props?.for === "string" ? node.props.for : undefined,
        },
        escapeText(node.text),
      );
    case "button":
      return el(
        "button",
        {
          // What the tile said, or nothing — the same choice the client
          // renderer makes. Writing `button` here regardless meant the served
          // HTML did not submit and the hydrated page did.
          type: node.type,
          "data-kumiki-tile": "button",
          disabled: node.disabled,
          id: tileIdOf(node),
        },
        escapeText(node.text),
      );
    case "input": {
      const bind = node.bindPath
        ? `${node.bind ?? ""}.${node.bindPath.join(".")}`
        : (node.bind ?? undefined);
      return el(
        "input",
        {
          type: node.type ?? "text",
          value: node.value ?? "",
          placeholder: node.placeholder,
          required: node.required,
          id: tileIdOf(node),
          accept: node.accept,
          multiple: node.multiple,
          "data-kumiki-tile": "input",
          "data-kumiki-bind": bind,
        },
        "",
      );
    }
    case "textarea": {
      const bind = node.bindPath
        ? `${node.bind ?? ""}.${node.bindPath.join(".")}`
        : (node.bind ?? undefined);
      return el(
        "textarea",
        {
          rows: node.rows,
          placeholder: node.placeholder,
          id: tileIdOf(node),
          "data-kumiki-tile": "textarea",
          "data-kumiki-bind": bind,
        },
        escapeText(node.value ?? ""),
      );
    }
    case "check":
      return el(
        "input",
        {
          type: "checkbox",
          checked: node.checked,
          "data-kumiki-tile": "check",
        },
        "",
      );
    case "switch":
      return el(
        "input",
        {
          type: "checkbox",
          role: "switch",
          checked: node.checked,
          "data-kumiki-tile": "switch",
        },
        "",
      );
    case "radio":
      return el(
        "input",
        {
          type: "radio",
          name: node.group,
          value: node.value === undefined ? undefined : String(node.value),
          checked: node.selected,
          "data-kumiki-tile": "radio",
        },
        "",
      );
    case "select": {
      const bind = node.bindPath
        ? `${node.bind ?? ""}.${node.bindPath.join(".")}`
        : (node.bind ?? undefined);
      const opts = (node.options ?? [])
        .map(
          (o) =>
            `<option value="${escapeAttr(String(o.value))}"${
              o.value === node.value ? " selected" : ""
            }>${escapeText(String(o.label))}</option>`,
        )
        .join("");
      return el(
        "select",
        { "data-kumiki-tile": "select", "data-kumiki-bind": bind, id: tileIdOf(node) },
        node.placeholder !== undefined
          ? `<option value="" disabled${node.value === undefined ? " selected" : ""}>${escapeText(node.placeholder)}</option>${opts}`
          : opts,
      );
    }
    case "slider": {
      const bind = node.bindPath
        ? `${node.bind ?? ""}.${node.bindPath.join(".")}`
        : (node.bind ?? undefined);
      return el(
        "input",
        {
          type: "range",
          value: node.value,
          min: node.min,
          max: node.max,
          step: node.step,
          "data-kumiki-tile": "slider",
          "data-kumiki-bind": bind,
          id: tileIdOf(node),
        },
        "",
      );
    }
    case "form":
      return el("form", { "data-kumiki-tile": "form" }, renderChildren(node.children));
    case "link":
      return el("a", { href: node.to, "data-kumiki-tile": "link" }, escapeText(node.text));
    case "markdown":
      // Match the live renderer's safety posture: don't parse markdown on the
      // server (it would diverge from whatever client-side markdown lib runs
      // post-hydration). Surface the raw source as text so it is at least
      // crawlable; the client replaces this on first render.
      return el("div", { "data-kumiki-tile": "markdown" }, escapeText(node.text));
    case "image":
      // `alt` is read from the props, not hardcoded empty: a served page whose
      // stated purpose is that a screen reader and a crawler see something is
      // the last place to throw the alt text away.
      return el(
        "img",
        {
          src: node.src,
          "data-kumiki-tile": "image",
          alt: typeof node.props?.alt === "string" ? node.props.alt : undefined,
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
      // `size` is deliberately not a text style here: it sizes the SVG box, and
      // the renderer pulls it out of the props before styling the span.
      const rest: TileProps = { ...(node.props ?? {}) };
      delete (rest as Record<string, unknown>).size;
      return el(
        "span",
        {
          "data-kumiki-tile": "icon",
          "data-kumiki-icon-name": node.name,
          style: styleAttr(node, textStyleDecls(rest)),
        },
        "",
      );
    }
    case "divider":
      return el("hr", { "data-kumiki-tile": "divider" }, "");
    case "code":
      return `<pre data-kumiki-tile="code"${
        node.lang ? ` data-lang="${escapeAttr(node.lang)}"` : ""
      }><code>${escapeText(node.text)}</code></pre>`;
    case "video":
      return el(
        "video",
        {
          src: node.src,
          controls: node.controls,
          autoplay: node.autoplay,
          "data-kumiki-tile": "video",
        },
        "",
      );
    case "list":
      return el(
        node.ordered ? "ol" : "ul",
        { "data-kumiki-tile": "list", style: containerStyle(node) },
        renderChildren(node.children),
      );
    case "list-item":
      return el("li", { "data-kumiki-tile": "list-item" }, renderChildren(node.children));
    case "table":
      return el("table", { "data-kumiki-tile": "table" }, renderChildren(node.children));
    case "table-head":
      return el("thead", { "data-kumiki-tile": "table-head" }, renderChildren(node.children));
    case "table-body":
      return el("tbody", { "data-kumiki-tile": "table-body" }, renderChildren(node.children));
    case "table-row":
      return el("tr", { "data-kumiki-tile": "table-row" }, renderChildren(node.children));
    case "table-cell":
      return el(
        "td",
        {
          colspan: node.colspan,
          rowspan: node.rowspan,
          "data-kumiki-tile": "table-cell",
        },
        renderChildren(node.children),
      );
    case "modal":
    case "drawer":
    case "popover":
      // Closed overlays render nothing on the server so the initial paint
      // matches what the user sees before they trigger the overlay. The
      // client takes ownership of focus + close handlers on hydration.
      if (!node.open) return "";
      return el(
        "div",
        {
          "data-kumiki-tile": node.kind,
          role: node.kind === "modal" ? "dialog" : undefined,
          "aria-label": node.title,
        },
        renderChildren(node.children),
      );
    case "tooltip":
      return el(
        "span",
        { "data-kumiki-tile": "tooltip", title: node.text },
        renderChildren(node.children),
      );
    case "toast":
      return el(
        "div",
        {
          "data-kumiki-tile": "toast",
          "data-level": node.level,
          role: "status",
        },
        escapeText(node.text ?? ""),
      );
    case "progress":
      return el(
        "progress",
        { value: node.value, max: node.max, "data-kumiki-tile": "progress" },
        "",
      );
    case "spinner":
      return el(
        "span",
        {
          "data-kumiki-tile": "spinner",
          role: "status",
          "aria-label": "Loading",
          style: styleAttr(node, []),
        },
        "",
      );
    case "skeleton":
      return el("div", { "data-kumiki-tile": "skeleton", style: styleAttr(node, []) }, "");
    case "error":
      // Field-bound error messages depend on live refinement results — empty
      // on the server, the client renders the actual error on first render.
      return el("div", { "data-kumiki-tile": "error", "data-field": node.field }, "");
    case "route-outlet":
      return el("div", { "data-kumiki-tile": "route-outlet" }, renderChildren(node.children));
    case "details": {
      // Native <details> disclosure. SSR emits the current open state via
      // the `open` attribute so the server-painted collapse matches what
      // the client renders on hydration; children still emit inside so a
      // no-JS user (or search crawler) can read the content.
      const inner = `<summary>${escapeText(node.summary)}</summary>${renderChildren(node.children)}`;
      return `<details data-kumiki-tile="details"${node.open ? " open" : ""}>${inner}</details>`;
    }
    case "editable": {
      // contenteditable div. `bind=`, if present, becomes `data-kumiki-bind`
      // so the client picks up the same identity path used by input /
      // textarea. The initial text is escaped verbatim; caret / selection
      // state is a client-only concern.
      const bind = node.bindPath
        ? `${node.bind ?? ""}.${node.bindPath.join(".")}`
        : (node.bind ?? undefined);
      return el(
        "div",
        {
          "data-kumiki-tile": "editable",
          contenteditable: "true",
          "data-kumiki-bind": bind,
        },
        escapeText(node.text ?? ""),
      );
    }
  }
}
