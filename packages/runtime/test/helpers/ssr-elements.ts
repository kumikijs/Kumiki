import type { TileNode } from "@kumikijs/runtime";
import { mount, renderTileToString } from "@kumikijs/runtime";
import { appOf } from "./app.ts";

export function clientElement(node: TileNode): HTMLElement {
  const app = appOf(() => node);
  const host = document.createElement("div");
  document.body.appendChild(host);
  mount(app, host);
  const el = host.firstElementChild as HTMLElement | null;
  if (!el) throw new Error(`client rendered nothing for ${node.kind}`);
  // Detach from the mount before the caller reads it: `dispose` would empty the
  // host, and the element is what is under test, not the tree it sat in.
  el.remove();
  host.remove();
  return el;
}

const TABLE_PARTS: Record<string, { tag: string; wrap: (html: string) => string }> = {
  "table-head": { tag: "thead", wrap: (h) => `<table>${h}</table>` },
  "table-body": { tag: "tbody", wrap: (h) => `<table>${h}</table>` },
  "table-row": { tag: "tr", wrap: (h) => `<table><tbody>${h}</tbody></table>` },
  "table-cell": { tag: "td", wrap: (h) => `<table><tbody><tr>${h}</tr></tbody></table>` },
};

/** The server's element for the same node, parsed back into the DOM. */
export function serverElement(node: TileNode): HTMLElement {
  const host = document.createElement("div");
  const html = renderTileToString(node);
  const part = TABLE_PARTS[node.kind];
  host.innerHTML = part ? part.wrap(html) : html;
  const el = (part ? host.querySelector(part.tag) : host.firstElementChild) as HTMLElement | null;
  if (!el) throw new Error(`server rendered nothing for ${node.kind}`);
  return el;
}

export function styleOf(el: Element): Record<string, string> {
  const probe = document.createElement("div");
  probe.setAttribute("style", el.getAttribute("style") ?? "");
  const out: Record<string, string> = {};
  for (let i = 0; i < probe.style.length; i++) {
    const name = probe.style.item(i);
    out[name] = probe.style.getPropertyValue(name);
  }
  return out;
}

const PROPERTY_ON_THE_CLIENT = new Set(["value", "checked", "selected"]);

// An `<option>`'s `value` does reflect: the client writes the option's structural
// key into the attribute, so a served option has to carry the same key.
function propertyOnTheClient(el: Element, name: string): boolean {
  if (name === "value" && el.tagName === "OPTION") return false;
  return PROPERTY_ON_THE_CLIENT.has(name);
}

/** Every attribute except `style`, which is compared through the CSSOM. */
function attrsOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name === "style" || propertyOnTheClient(el, a.name)) continue;
    out[a.name] = a.value;
  }
  return out;
}

/** The text an element holds directly, i.e. not through a child element. */
function ownText(el: Element): string {
  let out = "";
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) out += n.nodeValue ?? "";
  }
  return out;
}

export type Shape = {
  tag: string;
  attrs: Record<string, string>;
  style: Record<string, string>;
  text?: string;
  children?: Shape[];
};

export function shapeOf(el: Element, opts: { deep: boolean; text: boolean }): Shape {
  const shape: Shape = { tag: el.tagName, attrs: attrsOf(el), style: styleOf(el) };
  if (opts.text) shape.text = ownText(el);
  if (opts.deep) {
    shape.children = Array.from(el.children).map((c) => shapeOf(c, opts));
  }
  return shape;
}
