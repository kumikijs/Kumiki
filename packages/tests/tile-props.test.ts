// Every documented tile prop, from `.kumiki` source to the DOM — on both
// rendering paths (#251).
//
// The bug this exists to prevent is not "a prop is unimplemented". It is that
// a prop's name has two spellings: the compiler lowers a Kumiki name to a
// JS-safe key (`test-id` -> `test_id`), while `TileProps` is
// `Record<string, unknown>`, so a runtime that reads `props["max-w"]` type-
// checks, renders, and does nothing. Every app in the corpus wrote `max-w` and
// none of them ever got a width.
//
// So every row here starts from SOURCE and ends at an ATTRIBUTE or a CSS
// declaration. A hand-built `TileNode` would let the test agree with the
// runtime about a spelling the compiler never emits — which is exactly how the
// gap survived a parity suite that compared the two render paths to each other.

import { mount, renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.js";

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

function sourceOf(tile: string): string {
  return [
    // A slot the control rows can bind to; unused by the rest.
    'slot draft : Text = ""',
    "",
    `tile Probe = ${tile}`,
    "",
    "app P",
    "  caps   = []",
    '  routes = {"/" -> Probe, "/404" -> Probe}',
    "  init   = []",
    "",
  ].join("\n");
}

async function clientElement(tile: string, at?: string): Promise<HTMLElement> {
  const app = await loadSource(sourceOf(tile));
  const target = document.createElement("div");
  document.body.appendChild(target);
  mount(app, target);
  const root = target.firstElementChild as HTMLElement | null;
  if (!root) throw new Error(`no element rendered for ${tile}`);
  const el = at ? (root.querySelector(at) as HTMLElement | null) : root;
  if (!el) throw new Error(`client: selector ${at} matched nothing for ${tile}`);
  return el;
}

async function serverElement(tile: string, at?: string): Promise<HTMLElement> {
  const app = await loadSource(sourceOf(tile));
  const { html } = await renderToString(app);
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const root = holder.firstElementChild as HTMLElement | null;
  if (!root) throw new Error(`server rendered nothing for ${tile}`);
  const el = at ? (root.querySelector(at) as HTMLElement | null) : root;
  if (!el) throw new Error(`server: selector ${at} matched nothing for ${tile}`);
  return el;
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
  // --- common props, spec/stdlib.md §2.3.10 ---
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

  // --- sizing, spec/style.md §4.3.1 + §4.4.7 ---
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
    // The theme has a `radius` scale and a separate `spacing` one; this read
    // spacing, so `radius: "md"` was 16px where the theme says 8px.
    name: "radius reads the radius scale, not the spacing scale",
    tile: 'box(text("x")) {radius: "md"}',
    claim: { style: { "border-radius": "8px" } },
  },
  {
    // The kinds whose renderers style nothing of their own: without the shared
    // pass these reach neither path, and the `image` line is the only code
    // example style.md §4.4.7 has.
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
    // The way to take input away from a contenteditable is to stop it being one.
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
    // A kind that maps a prop itself keeps it: an icon's `size` sizes the SVG
    // box, so the shared mapping must not also make it a font size.
    name: "a kind that owns a prop is not given the general answer for it",
    tile: 'icon(name="check") {size: "lg", color: "muted"}',
    claim: { style: { "font-size": "", color: "#888" } },
  },
  {
    // The other branch of `{radius: if c then "pill" else ""}`. An empty token
    // has to write nothing: on the mount path a declaration with an empty value
    // REMOVES the property, taking the card's own corners with it, while the
    // server serialises an invalid one and keeps them — the two paths
    // disagreeing over a plain conditional.
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
    // Hidden from assistive technology: a labelled spinner would join the
    // button's accessible name and make it "Loading go".
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

/**
 * Rows the server has no answer for. The class-backed layers are injected CSS
 * (`transition`, the `hover:` / `focus:` / `active:` blocks, motion), which
 * §10.6.1 keeps off the served page — so the classes the runtime owns exist
 * only after hydration, and only the client can say the author's tokens joined
 * them rather than replaced them.
 */
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

/**
 * Every prop that can go away, going away.
 *
 * The create path and the patch path are different code, and only the patch
 * path can be wrong about *removal* — a prop that stops being written has to
 * take its attribute or declaration with it. `BOUND_APP` above moves props from
 * one value to another; this moves them to absent.
 */
const REMOVAL_APP = `
slot set : Bool = true

reducer drop on=ui.click(Flip) do= set := !set

tile Flip  = button(text="flip")
tile Probe = column(
               Flip,
               button(text="go") {variant: if set then "ghost" else ""},
               image(src="/a.png", alt="A cat") {width: if set then 120 else ""},
               divider() {orientation: if set then "vertical" else "horizontal"},
               link(to="/next", text="next") {external: set},
               grid(text("g")) {cols: 2, rows: if set then 3 else ""},
               text("t") {class: if set then "lit" else "", test-id: if set then "t" else "",
                          role: if set then "note" else "", max-w: if set then 400 else ""},
               input(bind=draft) {disabled: set, auto-complete: if set then "off" else ""})
`;

describe("a prop that goes away takes its mark with it (#251)", () => {
  it("removes what the previous render wrote", async () => {
    const app = await loadSource(
      `slot draft : Text = ""
${REMOVAL_APP}
app P
  caps   = []
  routes = {"/" -> Probe, "/404" -> Probe}
  init   = []
`,
    );
    const target = document.createElement("div");
    document.body.appendChild(target);
    mount(app, target);
    const root = target.firstElementChild as HTMLElement;
    const at = (sel: string): HTMLElement => root.querySelector(sel) as HTMLElement;
    const go = root.querySelectorAll('[data-kumiki-tile="button"]')[1] as HTMLElement;
    const img = at('[data-kumiki-tile="image"]');
    const hr = at('[data-kumiki-tile="divider"]');
    const a = at('[data-kumiki-tile="link"]');
    const grid = at('[data-kumiki-tile="grid"]');
    // The grid holds a text tile of its own, so take the marked one: the last.
    const texts = root.querySelectorAll('[data-kumiki-tile="text"]');
    const text = texts[texts.length - 1] as HTMLElement;
    const input = at('[data-kumiki-tile="input"]') as HTMLInputElement;

    expect(go.getAttribute("data-kumiki-variant")).toBe("ghost");
    expect(img.getAttribute("width")).toBe("120");
    expect(hr.getAttribute("aria-orientation")).toBe("vertical");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(grid.style.getPropertyValue("grid-template-rows")).toBe("repeat(3, 1fr)");
    expect(text.getAttribute("class")).toBe("lit");
    expect(text.getAttribute("data-kumiki-test")).toBe("t");
    expect(text.getAttribute("role")).toBe("note");
    expect(text.style.getPropertyValue("max-width")).toBe("400px");
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("autocomplete")).toBe("off");

    (root.querySelector('[data-kumiki-tile="button"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    // Every element was reused: this is the patch path, not a rebuild.
    expect(root.querySelectorAll('[data-kumiki-tile="button"]')[1]).toBe(go);
    const after = root.querySelectorAll('[data-kumiki-tile="text"]');
    expect(after[after.length - 1]).toBe(text);
    expect(go.getAttribute("data-kumiki-variant")).toBe(null);
    expect(img.getAttribute("width")).toBe(null);
    expect(hr.getAttribute("aria-orientation")).toBe(null);
    expect(a.getAttribute("target")).toBe(null);
    expect(a.getAttribute("rel")).toBe(null);
    expect(grid.style.getPropertyValue("grid-template-rows")).toBe("");
    expect(text.getAttribute("class")).toBe("");
    expect(text.getAttribute("data-kumiki-test")).toBe(null);
    expect(text.getAttribute("role")).toBe(null);
    expect(text.style.getPropertyValue("max-width")).toBe("");
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("autocomplete")).toBe(null);
  });
});

/**
 * A tile whose common props are bound to a slot, plus the button that flips it.
 * The point is the SECOND render: these props are applied outside the per-kind
 * renderers, so nothing re-applies them on the patch path unless the reconcile
 * diffs them — and a reused element keeps whatever the first render put on it.
 */
const BOUND_APP = `
slot lit  : Bool = false
slot name : Text = ""

reducer flip on=ui.click(Flip) do= lit := !lit

tile Flip  = button(text="flip")
tile Probe = column(
               Flip,
               text("x") {class: if lit then "lit" else "dim",
                          test-id: if lit then "after" else "before",
                          aria: if lit then {label: "on"} else {}},
               button(text=if lit then "saving" else "save") {loading: lit},
               image(src="/a.png", alt="A cat", width=if lit then 200 else 100),
               input(bind=name, disabled=lit))
`;

async function mountBound(): Promise<{ root: HTMLElement; flip: () => Promise<void> }> {
  const app = await loadSource(
    `${BOUND_APP}\napp P\n  caps   = []\n  routes = {"/" -> Probe, "/404" -> Probe}\n  init   = []\n`,
  );
  const target = document.createElement("div");
  document.body.appendChild(target);
  mount(app, target);
  const root = target.firstElementChild as HTMLElement;
  return {
    root,
    flip: async () => {
      (root.querySelector('[data-kumiki-tile="button"]') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("a token resolves against the app's theme (#251)", () => {
  // Both passes are render passes, so both have to resolve `@token` references
  // against the app's own theme. The server had no bracket at all, so a themed
  // page was served with the built-in defaults and re-styled on hydration.
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
  const themed = {
    padding: "33px",
    "border-radius": "3px",
    "box-shadow": "0 0 9px red",
    background: "#123456",
  };

  it("client", async () => {
    const app = await loadSource(THEMED);
    const target = document.createElement("div");
    document.body.appendChild(target);
    mount(app, target);
    check(target.firstElementChild as HTMLElement, { style: themed });
  });

  it("server", async () => {
    const app = await loadSource(THEMED);
    const { html } = await renderToString(app);
    const holder = document.createElement("div");
    holder.innerHTML = html;
    check(holder.firstElementChild as HTMLElement, { style: themed });
  });
});

describe("an external link leaves the app (#251)", () => {
  /** Click the link and report whether the runtime took the navigation over. */
  async function clickIsIntercepted(to: string, props: string): Promise<boolean> {
    const app = await loadSource(sourceOf(`column(link(to="${to}", text="docs") ${props})`));
    const target = document.createElement("div");
    document.body.appendChild(target);
    mount(app, target);
    const a = target.querySelector('[data-kumiki-tile="link"]') as HTMLElement;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(click);
    // The router takes a link over by preventing the browser's own navigation.
    return click.defaultPrevented;
  }

  it("routes an ordinary link through the app", async () => {
    expect(await clickIsIntercepted("/next", "{}")).toBe(true);
  });

  it("leaves an external one to the browser", async () => {
    expect(await clickIsIntercepted("https://example.com", "{external: true}")).toBe(false);
  });

  // #298: `external` is the documented way to leave the app, but forgetting it
  // used to be fatal rather than merely unadorned — the handler cancelled the
  // click and then handed an off-origin URL to `history.pushState`, which
  // refuses it with a SecurityError. The link was dead and the console said
  // nothing about the link. What the router cannot serve stays the browser's.
  it("leaves an off-origin target to the browser even without external", async () => {
    expect(await clickIsIntercepted("https://example.com/docs", "{}")).toBe(false);
  });

  it("leaves a non-http scheme to the browser", async () => {
    expect(await clickIsIntercepted("mailto:hi@example.com", "{}")).toBe(false);
  });

  it("routes an absolute URL to this origin", async () => {
    expect(await clickIsIntercepted(`${location.origin}/next`, "{}")).toBe(true);
  });

  it("routes a protocol-relative URL to this origin", async () => {
    expect(await clickIsIntercepted(`//${location.host}/next`, "{}")).toBe(true);
  });
});

describe("common props survive a re-render (#251)", () => {
  it("swaps the class rather than accumulating both", async () => {
    const { root, flip } = await mountBound();
    const text = root.querySelector('[data-kumiki-tile="text"]') as HTMLElement;
    expect(text.getAttribute("class")).toBe("dim");
    await flip();
    expect(root.querySelector('[data-kumiki-tile="text"]')).toBe(text);
    expect(text.getAttribute("class")).toBe("lit");
  });

  it("rewrites a test-id and drops an aria key that went away", async () => {
    const { root, flip } = await mountBound();
    const text = root.querySelector('[data-kumiki-tile="text"]') as HTMLElement;
    expect(text.getAttribute("data-kumiki-test")).toBe("before");
    expect(text.getAttribute("aria-label")).toBe(null);
    await flip();
    expect(text.getAttribute("data-kumiki-test")).toBe("after");
    expect(text.getAttribute("aria-label")).toBe("on");
    await flip();
    expect(text.getAttribute("aria-label")).toBe(null);
  });

  it("keeps the same spinner element while the label changes", async () => {
    // Re-creating it would restart its animation mid-flight — a visible
    // stutter on exactly the button the user is waiting for. The label moves
    // here and `loading` does not, so the spinner has no reason to be touched.
    const app = await loadSource(`slot n : Int = 0

reducer bump on=ui.click(Bump) do= n := n + 1

tile Bump  = button(text="bump")
tile Probe = column(Bump, button(text="uploading " + n.show) {loading: true})

app P
  caps   = []
  routes = {"/" -> Probe, "/404" -> Probe}
  init   = []
`);
    const target = document.createElement("div");
    document.body.appendChild(target);
    mount(app, target);
    const root = target.firstElementChild as HTMLElement;
    const busy = root.querySelectorAll('[data-kumiki-tile="button"]')[1] as HTMLButtonElement;
    const spinner = busy.querySelector('[data-kumiki-tile="spinner"]');
    expect(spinner).not.toBe(null);
    (root.querySelector('[data-kumiki-tile="button"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(String(busy.textContent).includes("uploading 1")).toBe(true);
    expect(busy.querySelector('[data-kumiki-tile="spinner"]')).toBe(spinner);
  });

  it("disables a control in place", async () => {
    const { root, flip } = await mountBound();
    const input = root.querySelector('[data-kumiki-tile="input"]') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    await flip();
    expect(root.querySelector('[data-kumiki-tile="input"]')).toBe(input);
    expect(input.disabled).toBe(true);
  });

  it("resizes an image in place", async () => {
    const { root, flip } = await mountBound();
    const img = root.querySelector('[data-kumiki-tile="image"]') as HTMLElement;
    expect(img.getAttribute("width")).toBe("100");
    await flip();
    expect(root.querySelector('[data-kumiki-tile="image"]')).toBe(img);
    expect(img.getAttribute("width")).toBe("200");
  });

  it("turns a button's spinner on and back off", async () => {
    const { root, flip } = await mountBound();
    const save = root.querySelectorAll('[data-kumiki-tile="button"]')[1] as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(save.querySelector('[data-kumiki-tile="spinner"]')).toBe(null);
    await flip();
    expect(save.disabled).toBe(true);
    expect(save.querySelector('[data-kumiki-tile="spinner"]')).not.toBe(null);
    // The label is still the button's accessible name with a spinner in front.
    expect(String(save.textContent).includes("saving")).toBe(true);
    await flip();
    expect(save.disabled).toBe(false);
    expect(save.querySelector('[data-kumiki-tile="spinner"]')).toBe(null);
  });
});

describe("documented tile props reach the DOM (#251)", () => {
  for (const row of CLIENT_ONLY) {
    it(`client: ${row.name}`, async () => {
      check(await clientElement(row.tile, row.claim.at), row.claim);
    });
  }
  for (const row of BOTH_PATHS) {
    it(`client: ${row.name}`, async () => {
      check(await clientElement(row.tile, row.claim.at), row.claim);
    });
    it(`server: ${row.name}`, async () => {
      check(await serverElement(row.tile, row.claim.at), row.claim);
    });
  }
});
