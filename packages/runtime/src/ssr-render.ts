import { attrValue, type TileNode } from "./core.ts";
import {
  bindAttr,
  controlAttrs,
  el,
  escapeAttr,
  escapeText,
  serializeAttrs,
  stringAttr,
  tileIdOf,
} from "./ssr-render/html.ts";
import { overlayLayerStyle } from "./ssr-render/style.ts";
import { headingTag } from "./tiles/text/heading.ts";

/** The spinner a loading button carries, as the renderer builds it. */
const BUTTON_SPINNER =
  '<span data-kumiki-tile="spinner" aria-hidden="true" style="margin-right: 0.4em"></span>';

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
