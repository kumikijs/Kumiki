import { renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

/** What a row claims about one element, checked identically on both paths. */
type Claim = {
  /** Selector for the element under test; the root tile's element when absent. */
  at?: string;
  /** The element name, lower-case, when the claim is about which element it is. */
  tag?: string;
  /** `null` asserts the attribute is absent. */
  attrs?: Record<string, string | null>;
  /** CSS property -> value, read through the CSSOM on both sides. */
  style?: Record<string, string>;
};

type Row = {
  name: string;
  /** The root tile expression, verbatim. */
  tile: string;
  claim: Claim;
};

// The slot is for the control rows to bind to; the rest leave it unused.
const sourceOf = (tile: string): string =>
  withApp(
    `slot draft : Text = ""
tile Probe = ${tile}`,
    "Probe",
  );

function pick(root: Element | null, at: string | undefined, where: string): HTMLElement {
  if (!root) throw new Error(`${where} rendered nothing`);
  const el = at ? root.querySelector<HTMLElement>(at) : (root as HTMLElement);
  if (!el) throw new Error(`${where}: selector ${at} matched nothing`);
  return el;
}

async function clientElement(src: string, at?: string): Promise<HTMLElement> {
  const { root } = mountApp(await loadSource(src));
  return pick(root.firstElementChild, at, "client");
}

async function serverElement(src: string, at?: string): Promise<HTMLElement> {
  const { html } = await renderToString(await loadSource(src));
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return pick(holder.firstElementChild, at, "server");
}

function check(el: HTMLElement, claim: Claim): void {
  if (claim.tag !== undefined) expect(el.tagName.toLowerCase()).toBe(claim.tag);
  for (const [attr, value] of Object.entries(claim.attrs ?? {})) {
    expect(el.getAttribute(attr), `attribute ${attr}`).toBe(value);
  }
  for (const [prop, value] of Object.entries(claim.style ?? {})) {
    expect(el.style.getPropertyValue(prop), `css ${prop}`).toBe(value);
  }
}

/** Rows whose claim holds on the client and on the server alike. */
const BOTH_PATHS: Row[] = [
  // --- common props ---
  {
    name: "class lands on the element",
    tile: 'column(text("x")) {class: "wide muted"}',
    claim: { attrs: { class: "wide muted" } },
  },
  {
    name: "aria map becomes aria-* attributes",
    tile: 'column(text("x")) {aria: {label: "Sidebar", hidden: "true"}}',
    claim: { attrs: { "aria-label": "Sidebar", "aria-hidden": "true" } },
  },
  {
    name: "an aria key already spelled aria-… is not prefixed twice",
    tile: 'column(text("x")) {aria: {aria-live: "polite"}}',
    claim: { attrs: { "aria-live": "polite", "aria-aria-live": null } },
  },
  {
    name: "an aria-* prop is an attribute wherever it is written",
    tile: 'column(text("x")) {aria-label: "Main"}',
    claim: { attrs: { "aria-label": "Main" } },
  },
  {
    name: "test-id becomes the attribute the testing spec queries",
    tile: 'column(text("x")) {test-id: "add-btn"}',
    claim: { attrs: { "data-kumiki-test": "add-btn" } },
  },
  {
    name: "role is written where it is asked for",
    tile: 'region(text("x")) {role: "navigation", aria-label: "Main"}',
    claim: { attrs: { role: "navigation", "aria-label": "Main" } },
  },
  {
    name: "no role is invented for a region that did not ask",
    tile: 'region(text("x"))',
    claim: { attrs: { role: null } },
  },

  // --- sizing ---
  {
    name: "max-w reaches the DOM under the name the compiler emits",
    tile: 'column(text("x")) {max-w: 640}',
    claim: { style: { "max-width": "640px" } },
  },
  {
    name: "w full / auto resolve, other sizes pass through",
    tile: 'column(text("x")) {w: "full", h: 40, min-w: "auto", max-h: "50vh"}',
    claim: {
      style: { width: "100%", height: "40px", "min-width": "auto", "max-height": "50vh" },
    },
  },
  {
    name: "aspect is a ratio",
    tile: 'column(text("x")) {aspect: "16/9"}',
    claim: { style: { "aspect-ratio": "16 / 9" } },
  },
  {
    name: "wrap is a boolean, not a token",
    tile: 'row(text("x")) {wrap: true}',
    claim: { style: { "flex-wrap": "wrap" } },
  },
  {
    name: "pad-x / pad-y split the axes and outrank pad",
    tile: 'column(text("x")) {pad: "sm", pad-x: "lg"}',
    claim: {
      style: {
        "padding-left": "24px",
        "padding-right": "24px",
        "padding-top": "8px",
        "padding-bottom": "8px",
      },
    },
  },
  {
    name: "gap-x / gap-y are the per-axis gaps",
    tile: 'grid(text("x")) {gap-x: "sm", gap-y: "lg"}',
    claim: { style: { "column-gap": "8px", "row-gap": "24px" } },
  },
  {
    name: "shadow is a token",
    tile: 'card(text("x")) {shadow: "sm"}',
    claim: { style: { "box-shadow": "0 1px 2px rgba(0,0,0,0.1)" } },
  },
  {
    name: "radius reads the radius scale, not the spacing scale",
    tile: 'box(text("x")) {radius: "md"}',
    claim: { style: { "border-radius": "8px" } },
  },
  {
    name: "an image is sized by the same props a container is",
    tile: 'image(src="/a.png", alt="c") {w: "full", max-w: 600, aspect: "16/9"}',
    claim: { style: { width: "100%", "max-width": "600px", "aspect-ratio": "16 / 9" } },
  },
  {
    name: "a button takes the style shorthands forms.md writes on it",
    tile: 'button(text="go") {bg: "primary", max-w: 200}',
    claim: { style: { background: "#0070f3", "max-width": "200px" } },
  },
  {
    name: "id is an attribute on a kind that does not lift it",
    tile: 'column(text("x")) {id: "main"}',
    claim: { attrs: { id: "main" } },
  },
  {
    name: "a check is the label that wraps it, on both paths",
    tile: 'check(value=true) {class: "cb"}',
    claim: { tag: "label", attrs: { class: "cb", "data-kumiki-tile": "check" } },
  },
  {
    name: "a disabled check disables the control inside the label",
    tile: "check(value=true) {disabled: true}",
    claim: { at: "input", attrs: { disabled: "", type: "checkbox" } },
  },
  {
    name: "a disabled editable is not editable",
    tile: "editable(bind=draft) {disabled: true}",
    claim: { attrs: { contenteditable: "false" } },
  },
  {
    name: "a select is not given a read-only state it does not have",
    tile: 'select(bind=draft, options=[], placeholder="pick") {readonly: true}',
    claim: { attrs: { readonly: null } },
  },
  {
    name: "min-h and a false wrap are declarations too",
    tile: 'row(text("x")) {min-h: 40, wrap: false}',
    claim: { style: { "min-height": "40px", "flex-wrap": "nowrap" } },
  },
  {
    name: "radius takes the whole scale, and a value outside it passes through",
    tile: 'box(text("x")) {radius: "pill"}',
    claim: { style: { "border-radius": "999px" } },
  },
  {
    name: "a kind that owns a prop is not given the general answer for it",
    tile: 'icon(name="check") {size: "lg", color: "muted"}',
    claim: { style: { "font-size": "", color: "#888" } },
  },
  {
    name: "an empty token leaves the kind's own base alone",
    tile: 'card(text("x")) {radius: "", bg: ""}',
    claim: { style: { "border-radius": "8px", background: "" } },
  },
  {
    name: "a token the scale does not name is CSS already",
    tile: 'box(text("x")) {radius: "50%"}',
    claim: { style: { "border-radius": "50%" } },
  },
  {
    name: "shadow none is none",
    tile: 'card(text("x")) {shadow: "none"}',
    claim: { style: { "box-shadow": "none" } },
  },
  {
    name: "loading written as an argument is the same button",
    tile: 'button(text="go", loading=true)',
    claim: { attrs: { disabled: "", "aria-busy": "true" } },
  },
  {
    name: "a bare aria-label outranks the same key in the aria map",
    tile: 'region(text("x")) {aria: {label: "from the map"}, aria-label: "written on its own"}',
    claim: { attrs: { "aria-label": "written on its own" } },
  },
  {
    name: "an aria that is not a map writes no attribute at all",
    tile: 'text("z") {aria: "hi"}',
    claim: { attrs: { "aria-0": null, "aria-1": null } },
  },
  {
    name: "grid rows mirror grid cols",
    tile: 'grid(text("x")) {cols: 2, rows: 3}',
    claim: {
      style: { "grid-template-columns": "repeat(2, 1fr)", "grid-template-rows": "repeat(3, 1fr)" },
    },
  },

  // --- per-tile props ---
  {
    name: "a disabled button is disabled, written as a prop",
    tile: 'button(text="go") {disabled: true}',
    claim: { attrs: { disabled: "" } },
  },
  {
    name: "a disabled button is disabled, written as an argument",
    tile: 'button(text="go", disabled=true)',
    claim: { attrs: { disabled: "" } },
  },
  {
    name: "a loading button is disabled and says so",
    tile: 'button(text="go") {loading: true}',
    claim: { attrs: { disabled: "", "aria-busy": "true" } },
  },
  {
    name: "a loading button carries a spinner, and it is not part of the name",
    tile: 'button(text="go") {loading: true}',
    claim: { at: '[data-kumiki-tile="spinner"]', attrs: { "aria-hidden": "true", role: null } },
  },
  {
    name: "variant is a selector hook",
    tile: 'button(text="go") {variant: "ghost"}',
    claim: { attrs: { "data-kumiki-variant": "ghost" } },
  },
  {
    name: "a control the spec calls disabled is disabled",
    tile: "input(bind=draft, disabled=true)",
    claim: { attrs: { disabled: "" } },
  },
  {
    name: "readonly and auto-complete reach a control too",
    tile: 'textarea(bind=draft, readonly=true, auto-complete="off")',
    claim: { attrs: { readonly: "", autocomplete: "off" } },
  },
  {
    name: "a select says whether it is disabled",
    tile: 'select(bind=draft, options=[], placeholder="pick") {disabled: true}',
    claim: { attrs: { disabled: "" } },
  },
  {
    name: "image alt survives the argument form",
    tile: 'image(src="/a.png", alt="A cat")',
    claim: { attrs: { alt: "A cat" } },
  },
  {
    name: "image width / height / loading reach the DOM",
    tile: 'image(src="/a.png", alt="A cat", width=120, height=80, loading="lazy")',
    claim: { attrs: { width: "120", height: "80", loading: "lazy" } },
  },
  {
    name: "an external link opens out of the app, safely",
    tile: 'link(to="https://example.com", text="docs") {external: true}',
    claim: { attrs: { target: "_blank", rel: "noopener noreferrer" } },
  },
  {
    name: "a link that is not external says nothing about targets",
    tile: 'link(to="/next", text="next")',
    claim: { attrs: { target: null, rel: null } },
  },
  {
    name: "a vertical divider is vertical",
    tile: 'divider() {orientation: "vertical"}',
    claim: { attrs: { "aria-orientation": "vertical" } },
  },
];

const CLIENT_ONLY: Row[] = [
  {
    name: "class does not displace a class the runtime owns",
    tile: 'column(text("x")) {class: "wide", transition: "fade"}',
    claim: { attrs: { class: "kumiki-anim kumiki-anim-fade wide" } },
  },
  {
    name: "transition-duration picks the animation's speed",
    tile: 'column(text("x")) {transition: "fade", transition-duration: "slow"}',
    claim: { attrs: { class: "kumiki-anim kumiki-anim-fade kumiki-anim-slow" } },
  },
];

describe("documented tile props reach the DOM", () => {
  it.each(CLIENT_ONLY)("client: $name", async ({ tile, claim }) => {
    check(await clientElement(sourceOf(tile), claim.at), claim);
  });

  it.each(BOTH_PATHS)("client: $name", async ({ tile, claim }) => {
    check(await clientElement(sourceOf(tile), claim.at), claim);
  });

  it.each(BOTH_PATHS)("server: $name", async ({ tile, claim }) => {
    check(await serverElement(sourceOf(tile), claim.at), claim);
  });
});

describe("a token resolves against the app's theme", () => {
  // Without it on the server, a themed page is served with the built-in defaults and re-styled on hydration.
  const THEMED = `theme T = {
  colors: {primary: "#123456"},
  spacing: {md: "33px"},
  radius: {md: "3px"},
  shadow: {sm: "0 0 9px red"}
}

tile Probe = box(text("x")) {pad: "md", radius: "md", shadow: "sm", bg: "primary"}

app P
  caps   = []
  theme  = T
  routes = {"/" -> Probe, "/404" -> Probe}
  init   = []
`;
  const style = {
    padding: "33px",
    "border-radius": "3px",
    "box-shadow": "0 0 9px red",
    background: "#123456",
  };

  it("client", async () => {
    check(await clientElement(THEMED), { style });
  });

  it("server", async () => {
    check(await serverElement(THEMED), { style });
  });
});
