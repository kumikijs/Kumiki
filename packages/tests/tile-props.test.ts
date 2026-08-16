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
    name: "a loading button carries a spinner",
    tile: 'button(text="go") {loading: true}',
    claim: { at: '[data-kumiki-tile="spinner"]', attrs: { role: "status" } },
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
