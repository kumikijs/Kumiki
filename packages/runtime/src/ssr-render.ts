// SSR tile walker (docs/spec/runtime.md §10.6.1). Walks a `TileNode` tree and
// produces an HTML string — no DOM, no `happy-dom`, no `tiles-*.ts`. Each
// `tiles-*.ts` renderer is designed for the live mount path (handler attach,
// focus restoration, motion classes, `_setSlot` write-back). None of those
// produce useful initial paint; the SSR pass only owns the first-byte HTML
// the client will hydrate over. Keeping the walker self-contained here means
// the runtime ships zero DOM-emulation deps on the server side, which the
// 30 KB bundle budget (§10.6.3) requires for Edge targets.

import type { TileNode } from "./core.ts";

const VOID_TAGS = new Set(["br", "hr", "img", "input"]);

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
 * Serialise one `TileNode` (plus its descendants) to an HTML string. The
 * output mirrors the live renderers structurally (same outer element kind,
 * same `data-kumiki-bind` attributes where applicable) so a screen reader /
 * search-engine sees a usable initial paint, but it omits everything the
 * client owns: event handlers, focus state, motion classes, `_setSlot`
 * data-attrs. The client mount replaces this DOM wholesale on its first
 * `render()` after hydration — node identity is NOT preserved on purpose.
 */
export function renderTileToString(node: TileNode): string {
  switch (node.kind) {
    case "page":
    case "column":
      return el("div", { "data-kumiki-tile": node.kind }, renderChildren(node.children));
    case "row":
      return el("div", { "data-kumiki-tile": "row" }, renderChildren(node.children));
    case "card":
      return el("div", { "data-kumiki-tile": "card" }, renderChildren(node.children));
    case "box":
      return el("div", { "data-kumiki-tile": "box" }, renderChildren(node.children));
    case "grid":
    case "stack":
    case "region":
    case "scroll":
    case "panel":
    case "fieldset":
    case "overlay":
      return el("div", { "data-kumiki-tile": node.kind }, renderChildren(node.children));
    case "heading":
      return el("h1", { "data-kumiki-tile": "heading" }, escapeText(node.text));
    case "text":
      return el("span", { "data-kumiki-tile": "text" }, escapeText(node.text));
    case "label":
      return el("label", { "data-kumiki-tile": "label" }, escapeText(node.text));
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
          id: node.id,
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
          id: node.id,
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
        { "data-kumiki-tile": "select", "data-kumiki-bind": bind },
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
      return el("img", { src: node.src, "data-kumiki-tile": "image", alt: "" }, "");
    case "icon":
      // Placeholder — the client renderer resolves the icon name against
      // `app.icons` and injects a real SVG path. SSR keeps the slot reserved
      // so the layout doesn't reflow on hydration.
      return el("span", { "data-kumiki-tile": "icon", "data-icon": node.name }, "");
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
        { "data-kumiki-tile": "list" },
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
      return el("div", { "data-kumiki-tile": "spinner", role: "status" }, "");
    case "skeleton":
      return el("div", { "data-kumiki-tile": "skeleton" }, "");
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
