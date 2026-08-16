// The server pass and the client renderers have to agree about what a tile
// looks like before any JavaScript runs. They did not: `ssr-render.ts` never
// read `props` at all, so every flex container was served as a block and the
// page reflowed the moment hydration finished — the layout shift SSR exists to
// avoid.
//
// This file compares the two paths node by node rather than asserting a
// hand-written HTML string, because the failure mode is drift: a renderer
// gaining a style the server pass does not learn about.

import type { AppShape, TileNode } from "@kumikijs/runtime";
import { mount, renderTileToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

/**
 * The client's element for one node, rendered through the real mount so the
 * renderer registry, the theme defaults and the prop appliers are the ones an
 * app actually gets.
 */
function clientElement(node: TileNode): HTMLElement {
  const app: AppShape = {
    slots: {},
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    root: () => node,
  };
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

/** The server's element for the same node, parsed back into the DOM. */
function serverElement(node: TileNode): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderTileToString(node);
  const el = host.firstElementChild as HTMLElement | null;
  if (!el) throw new Error(`server rendered nothing for ${node.kind}`);
  return el;
}

/**
 * A style attribute as a property→value map, normalised by the CSSOM on both
 * sides so `#fff` vs `rgb(255, 255, 255)` and declaration order are not what
 * this test is about.
 */
function styleOf(el: HTMLElement): Record<string, string> {
  const probe = document.createElement("div");
  probe.setAttribute("style", el.getAttribute("style") ?? "");
  const out: Record<string, string> = {};
  for (let i = 0; i < probe.style.length; i++) {
    const name = probe.style.item(i);
    out[name] = probe.style.getPropertyValue(name);
  }
  return out;
}

/**
 * Attribute names the server must write and the client never does, because the
 * client sets the corresponding DOM *property*. Form state is not an attribute
 * once a document is live — `input.value = x` leaves the markup untouched — but
 * an attribute is the only way a served page can carry it, so this asymmetry is
 * the contract rather than a divergence.
 */
const PROPERTY_ON_THE_CLIENT = new Set(["value", "max", "checked"]);

/** Every attribute except `style`, which is compared through the CSSOM. */
function attrsOf(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name === "style" || PROPERTY_ON_THE_CLIENT.has(a.name)) continue;
    out[a.name] = a.value;
  }
  return out;
}

const CONTAINER_PROPS = {
  gap: "sm",
  align: "center",
  justify: "between",
  pad: "lg",
  "max-w": 720,
  bg: "surface",
  radius: "md",
  style: { "letter-spacing": "0.02em" },
};

const TEXT_PROPS = {
  color: "primary",
  size: "xxl",
  weight: "bold",
  strike: true,
  style: { "text-transform": "uppercase" },
};

/** One representative node per kind the server pass knows how to render. */
const NODES: [string, TileNode][] = [
  ["page", { kind: "page", children: [], props: CONTAINER_PROPS }],
  ["column", { kind: "column", children: [], props: CONTAINER_PROPS }],
  ["row", { kind: "row", children: [], props: CONTAINER_PROPS }],
  ["card", { kind: "card", children: [], props: CONTAINER_PROPS }],
  ["card (no pad)", { kind: "card", children: [] }],
  ["box", { kind: "box", children: [], props: CONTAINER_PROPS }],
  ["stack", { kind: "stack", children: [], props: CONTAINER_PROPS }],
  ["scroll", { kind: "scroll", children: [], props: CONTAINER_PROPS }],
  ["panel", { kind: "panel", children: [], props: CONTAINER_PROPS }],
  ["fieldset", { kind: "fieldset", children: [], props: CONTAINER_PROPS }],
  ["region", { kind: "region", children: [], props: CONTAINER_PROPS }],
  ["grid", { kind: "grid", children: [], props: { ...CONTAINER_PROPS, cols: 4 } }],
  ["grid (default cols)", { kind: "grid", children: [] }],
  ["heading", { kind: "heading", text: "Title", props: TEXT_PROPS }],
  ["text", { kind: "text", text: "body", props: TEXT_PROPS }],
  ["label", { kind: "label", text: "Email", props: { for: "email" } }],
  ["form", { kind: "form", children: [], props: CONTAINER_PROPS }],
  ["list", { kind: "list", children: [], props: CONTAINER_PROPS }],
  ["divider", { kind: "divider", props: CONTAINER_PROPS }],
  ["overlay", { kind: "overlay", children: [], props: CONTAINER_PROPS }],
  ["icon", { kind: "icon", name: "star", props: { ...TEXT_PROPS, size: "lg" } }],
  ["button", { kind: "button", text: "Send", type: "submit" }],
  ["input", { kind: "input", value: "v", placeholder: "p", id: "i", required: true }],
  ["spinner", { kind: "spinner" }],
  ["progress", { kind: "progress", value: 3, max: 10 }],
];

describe("the server pass renders what the client renders", () => {
  for (const [label, node] of NODES) {
    it(`agrees on ${label}`, () => {
      const client = clientElement(node);
      const server = serverElement(node);
      expect(server.tagName, "tag").toBe(client.tagName);
      expect(attrsOf(server), "attributes").toEqual(attrsOf(client));
      expect(styleOf(server), "style").toEqual(styleOf(client));
    });
  }

  it("resolves a responsive value to its base, which is all a server can know", () => {
    // `{base, md}` picks a breakpoint from `window.matchMedia` on the client.
    // There is no viewport on the server, so the base is what it emits — and
    // the client agrees whenever no breakpoint matches.
    const node: TileNode = { kind: "row", children: [], props: { gap: { base: "sm", md: "xl" } } };
    expect(styleOf(serverElement(node)).gap).toBe("8px");
  });
});
