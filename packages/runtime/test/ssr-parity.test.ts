// The server pass and the client renderers have to agree about what a tile
// looks like before any JavaScript runs. They did not: `ssr-render.ts` never
// read `props` at all, so every flex container was served as a block and the
// page reflowed the moment hydration finished — the layout shift SSR exists to
// avoid.
//
// This file compares the two paths node by node rather than asserting a
// hand-written HTML string, because the failure mode is drift: a renderer
// gaining a style the server pass does not learn about.
//
// Two properties make the comparison mean what it says (#296):
//
//   * It is EXHAUSTIVE. The table is a `Record<TileNode["kind"], …>`, so a new
//     kind fails the typecheck until it has a row, and `EVERY_TILE_KIND` below
//     re-checks the same thing at runtime against the renderer registry. There
//     is no longer a silent gap between "verified to agree" and "not looked
//     at".
//   * It compares the SUBTREE, not the root. A kind whose children differ —
//     `markdown`'s paragraphs, `overlay`'s absolutely-positioned layers, a
//     surface's content box — is a divergence a root-only comparison cannot
//     see. Where a subtree legitimately differs, the kind's row says so in
//     prose (`noText`) rather than by omission.
//
// Being total over kinds is not being total over VALUES: the renderers gate on
// truthiness (`if (node.text)`) where the server hands the field to
// `serializeAttrs`, which drops only `undefined` / `null` / `false`. Every
// fixture carrying a non-empty value would agree while an empty one served
// `title=""` against no attribute at all, so the rows below carry the empty
// string and the zero for each field a renderer gates on.

import type { AppShape, TileNode } from "@kumikijs/runtime";
import {
  collectionTiles,
  inputTiles,
  layoutTiles,
  mediaTiles,
  mount,
  overlayTiles,
  renderTileToString,
  statusTiles,
  textTiles,
} from "@kumikijs/runtime";
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

/**
 * What a table part has to be parsed inside. The HTML parser drops a `<thead>`
 * or a `<td>` that arrives with no table around it, so reading one back
 * through `div.innerHTML` says the server rendered nothing when it rendered
 * exactly the right element. A fact about this harness, not about either
 * render path — the client builds its `<td>` with `createElement` and never
 * meets the parser at all.
 */
const TABLE_PARTS: Record<string, { tag: string; wrap: (html: string) => string }> = {
  "table-head": { tag: "thead", wrap: (h) => `<table>${h}</table>` },
  "table-body": { tag: "tbody", wrap: (h) => `<table>${h}</table>` },
  "table-row": { tag: "tr", wrap: (h) => `<table><tbody>${h}</tbody></table>` },
  "table-cell": { tag: "td", wrap: (h) => `<table><tbody><tr>${h}</tr></tbody></table>` },
};

/** The server's element for the same node, parsed back into the DOM. */
function serverElement(node: TileNode): HTMLElement {
  const host = document.createElement("div");
  const html = renderTileToString(node);
  const part = TABLE_PARTS[node.kind];
  host.innerHTML = part ? part.wrap(html) : html;
  const el = (part ? host.querySelector(part.tag) : host.firstElementChild) as HTMLElement | null;
  if (!el) throw new Error(`server rendered nothing for ${node.kind}`);
  return el;
}

/**
 * A style attribute as a property→value map, normalised by the CSSOM on both
 * sides so `#fff` vs `rgb(255, 255, 255)` and declaration order are not what
 * this test is about.
 *
 * The blind spot worth knowing: a property `happy-dom` does not implement is
 * dropped from BOTH maps and the two compare equal. `inset` was exactly that —
 * assigned on the client it vanished, parsed from the server's attribute it
 * survived, and the harness saw neither. A declaration this suite has never
 * seen fail is worth checking by hand once.
 */
function styleOf(el: Element): Record<string, string> {
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
 * The three attributes the server must write and a mounted element cannot have,
 * because the client sets a property that does NOT reflect: `input.value = x`,
 * `input.checked = true` and `option.selected = true` all leave the markup
 * untouched. An attribute is the only way a served page can carry them, so the
 * asymmetry is the contract for these three.
 *
 * It is exactly three. `disabled`, `readonly`, `open` and `max` reflect — the
 * property assignment writes the attribute — so they are compared like any
 * other, and excluding them dropped `controlAttrs`, `<details open>` and a
 * slider's `max` from a gate that claims to compare every kind subtree-deep.
 *
 * Dropping an attribute from BOTH shapes is the only way a subtree comparison
 * can proceed, and it means the comparison says nothing about the server half.
 * `carries the form state a live element cannot` below is where that half is
 * asserted; without it, deleting `value` from `ssr-render.ts` was a silent,
 * permanent regression.
 *
 * The set is by NAME, not by element, and `<option value>` is the one place
 * that is wrong: an option's `value` DOES reflect, so the two paths disagree
 * there (the client writes `valueKey`'s JSON, the server the plain string) and
 * this exclusion hides it. Tracked in #404, which is where the encoding gets
 * decided; the harness needs a per-element exclusion to compare it.
 */
const PROPERTY_ON_THE_CLIENT = new Set(["value", "checked", "selected"]);

/** Every attribute except `style`, which is compared through the CSSOM. */
function attrsOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name === "style" || PROPERTY_ON_THE_CLIENT.has(a.name)) continue;
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

/**
 * What the two paths are compared as: an element's tag, the attributes and
 * style it carries, the text it holds itself, and the same for every element
 * below it. Serialised into a plain object rather than asserted field by field
 * so a failure names the path that differs and shows both sides.
 */
type Shape = {
  tag: string;
  attrs: Record<string, string>;
  style: Record<string, string>;
  text?: string;
  children?: Shape[];
};

function shapeOf(el: Element, opts: { deep: boolean; text: boolean }): Shape {
  const shape: Shape = { tag: el.tagName, attrs: attrsOf(el), style: styleOf(el) };
  if (opts.text) shape.text = ownText(el);
  if (opts.deep) {
    shape.children = Array.from(el.children).map((c) => shapeOf(c, opts));
  }
  return shape;
}

// Prop names are the LOWERED form, which is the only spelling the runtime
// reads: the compiler maps a Kumiki name to a JS-safe key, so `max-w` arrives
// as `max_w`. Written the other way, this fixture agreed with a runtime that
// read `props["max-w"]` — and both sides were dead for every compiled app.
const CONTAINER_PROPS = {
  gap: "sm",
  align: "center",
  justify: "between",
  pad: "lg",
  max_w: 720,
  w: "full",
  wrap: true,
  shadow: "sm",
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

/** The common props every kind accepts (stdlib.md §2.3.10), on one node. */
const COMMON_PROPS = {
  class: "a b",
  test_id: "t",
  aria: { label: "Labelled" },
};

/** A child to hang under a container, so a container's subtree is not empty. */
const CHILD: TileNode = { kind: "text", text: "child" };

type ParityCase = [label: string, node: TileNode];

/**
 * One kind's row. `cases` is what gets compared, subtree-deep; `noText` is the
 * only way to stop comparing something, and it has to say why — an omission
 * cannot express "we did not look", which is what made the old table's silence
 * unreadable.
 */
type KindRow = {
  cases: [ParityCase, ...ParityCase[]];
  /** Why the text the two paths hold is not compared. */
  noText?: string;
};

/**
 * A node per kind, compared subtree-deep unless the row says otherwise.
 *
 * Typed as a total record over `TileNode["kind"]`: a kind added to the union
 * without a row here does not typecheck, which is the half of exhaustiveness a
 * runtime check cannot do (the union does not exist at runtime).
 */
const TABLE: Record<TileNode["kind"], KindRow> = {
  page: {
    cases: [
      ["page", { kind: "page", children: [CHILD], props: CONTAINER_PROPS }],
      ["page (common props)", { kind: "page", children: [], props: COMMON_PROPS }],
    ],
  },
  column: { cases: [["column", { kind: "column", children: [CHILD], props: CONTAINER_PROPS }]] },
  row: { cases: [["row", { kind: "row", children: [CHILD], props: CONTAINER_PROPS }]] },
  card: {
    cases: [
      ["card", { kind: "card", children: [CHILD], props: CONTAINER_PROPS }],
      ["card (no pad)", { kind: "card", children: [] }],
    ],
  },
  box: { cases: [["box", { kind: "box", children: [CHILD], props: CONTAINER_PROPS }]] },
  stack: { cases: [["stack", { kind: "stack", children: [CHILD], props: CONTAINER_PROPS }]] },
  scroll: { cases: [["scroll", { kind: "scroll", children: [CHILD], props: CONTAINER_PROPS }]] },
  panel: { cases: [["panel", { kind: "panel", children: [CHILD], props: CONTAINER_PROPS }]] },
  fieldset: {
    cases: [["fieldset", { kind: "fieldset", children: [CHILD], props: CONTAINER_PROPS }]],
  },
  region: { cases: [["region", { kind: "region", children: [CHILD], props: CONTAINER_PROPS }]] },
  grid: {
    cases: [
      ["grid", { kind: "grid", children: [CHILD], props: { ...CONTAINER_PROPS, cols: 4 } }],
      ["grid (default cols)", { kind: "grid", children: [] }],
      ["grid (rows)", { kind: "grid", children: [], props: { cols: "1fr auto", rows: 2 } }],
    ],
  },
  overlay: {
    cases: [
      // Children `[1..]` are each wrapped in an absolutely-positioned layer on
      // the client; the base child stays in flow. A root-only comparison saw
      // none of that.
      ["overlay", { kind: "overlay", children: [CHILD], props: CONTAINER_PROPS }],
      [
        "overlay (layers)",
        {
          kind: "overlay",
          children: [CHILD, { kind: "text", text: "over" }, { kind: "text", text: "more" }],
          props: { align: "top-right" },
        },
      ],
      [
        "overlay (default align)",
        { kind: "overlay", children: [CHILD, { kind: "text", text: "over" }] },
      ],
      // The arms of the align mapping the other two rows leave unvisited. It is
      // the one piece of logic this file has a second copy of, and with only
      // `top-right` and the default compared, flipping `bottom` or `left` on
      // one side alone kept the suite green.
      [
        "overlay (bottom-left)",
        {
          kind: "overlay",
          children: [CHILD, { kind: "text", text: "over" }],
          props: { align: "bottom-left" },
        },
      ],
      // A `when` that renders nothing is a null child on both paths, and the
      // layer index counts what survives it.
      [
        "overlay (hole where a child would be)",
        {
          kind: "overlay",
          children: [CHILD, null as unknown as TileNode, { kind: "text", text: "over" }],
        },
      ],
    ],
  },
  "route-outlet": {
    cases: [["route-outlet", { kind: "route-outlet", children: [CHILD], props: CONTAINER_PROPS }]],
  },
  heading: { cases: [["heading", { kind: "heading", text: "Title", props: TEXT_PROPS }]] },
  text: { cases: [["text", { kind: "text", text: "body", props: TEXT_PROPS }]] },
  label: { cases: [["label", { kind: "label", text: "Email", props: { for: "email" } }]] },
  link: {
    cases: [
      ["link", { kind: "link", text: "Home", to: "/", props: TEXT_PROPS }],
      [
        "link (external)",
        { kind: "link", text: "Docs", to: "https://x", props: { external: true } },
      ],
    ],
  },
  markdown: {
    cases: [
      ["markdown", { kind: "markdown", text: "one\ntwo\n\nthree", props: TEXT_PROPS }],
      ["markdown (empty)", { kind: "markdown", text: "" }],
    ],
  },
  code: {
    cases: [
      ["code", { kind: "code", text: "const a = 1", lang: "ts", props: CONTAINER_PROPS }],
      ["code (no lang)", { kind: "code", text: "plain" }],
    ],
  },
  icon: {
    cases: [["icon", { kind: "icon", name: "star", props: { ...TEXT_PROPS, size: "lg" } }]],
    noText:
      "the client writes `[name]` while the icon is unresolved and an <svg> once it is; the " +
      "server serves the empty placeholder either way (spec §10.6.1), so the two agree on the " +
      "element and not on what is in it",
  },
  form: { cases: [["form", { kind: "form", children: [CHILD], props: CONTAINER_PROPS }]] },
  button: {
    cases: [
      ["button", { kind: "button", text: "Send", type: "submit" }],
      ["button (id in props)", { kind: "button", text: "Send", props: { id: "send" } }],
      // FALSY: `if (node.type)` on the client against a raw field on the server.
      ["button (empty type)", { kind: "button", text: "", type: "" }],
      [
        "button (loading)",
        { kind: "button", text: "Save", props: { loading: true, variant: "primary" } },
      ],
    ],
  },
  input: {
    cases: [
      ["input", { kind: "input", value: "v", placeholder: "p", id: "i", required: true }],
      // The other form an id arrives in. `input(id=…)` sets the field, `{id: …}`
      // sets the prop, and the renderers read both — the server read only the
      // first, so `label(for=…)` pointed at nothing on a served page.
      ["input (id in props)", { kind: "input", value: "", props: { id: "from-props" } }],
      [
        "input (control state)",
        { kind: "input", value: "", props: { disabled: true, auto_complete: "email" } },
      ],
      // FALSY: placeholder / id / accept / bind all sit behind `if (…)` in the
      // renderer, and an empty one is a conditional's "not said" branch.
      [
        "input (every field empty)",
        {
          kind: "input",
          value: "",
          placeholder: "",
          id: "",
          accept: "",
          bind: "",
          props: { id: "" },
        },
      ],
      // `data-kumiki-bind` is the one attribute built from a path rather than
      // copied from a field, and a `.get` segment is not a string — so the two
      // renderers agree only as long as both go through `bindLabel`.
      [
        "input (bind through .get)",
        { kind: "input", value: "v", bind: "draft", bindPath: [{ get: true }, "title"] },
      ],
    ],
  },
  textarea: {
    cases: [
      [
        "textarea",
        { kind: "textarea", value: "hello", rows: 4, placeholder: "p", id: "t", bind: "draft" },
      ],
      // FALSY: `rows: 0` is no rows, not a one-line box.
      [
        "textarea (empty fields)",
        { kind: "textarea", value: "", rows: 0, placeholder: "", bind: "" },
      ],
    ],
    noText:
      "a textarea's value is its text on the server and its `.value` property on the client — " +
      "the same asymmetry `PROPERTY_ON_THE_CLIENT` covers for an <input>, one node down",
  },
  check: {
    cases: [
      ["check", { kind: "check", checked: true }],
      ["check (id, control state)", { kind: "check", checked: false, props: { id: "c" } }],
    ],
  },
  switch: {
    cases: [
      ["switch", { kind: "switch", checked: true }],
      ["switch (id)", { kind: "switch", checked: false, props: { id: "s" } }],
    ],
  },
  radio: {
    cases: [
      [
        "radio",
        { kind: "radio", group: "plan", value: "pro", selected: true, props: { label: "Pro" } },
      ],
      ["radio (no label)", { kind: "radio", group: "plan", value: "free" }],
    ],
  },
  select: {
    cases: [
      [
        "select",
        {
          kind: "select",
          value: "b",
          options: [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
          ],
          bind: "choice",
          props: { id: "sel" },
        },
      ],
      [
        "select (placeholder, nothing chosen)",
        {
          kind: "select",
          placeholder: "Pick one",
          options: [{ label: "A", value: "a" }],
        },
      ],
    ],
  },
  slider: {
    cases: [
      ["slider", { kind: "slider", value: 5, min: 0, max: 10, step: 2, bind: "vol" }],
      ["slider (bare)", { kind: "slider" }],
      // FALSY: `min: 0` IS a bound and stays; `bind: ""` is not one and goes.
      ["slider (zero bounds, no bind)", { kind: "slider", value: 0, min: 0, step: 0, bind: "" }],
    ],
  },
  editable: {
    cases: [
      ["editable", { kind: "editable", text: "note", bind: "draft", props: { id: "e" } }],
      ["editable (readonly)", { kind: "editable", text: "note", props: { readonly: true } }],
      ["editable (no bind)", { kind: "editable", text: "", bind: "" }],
    ],
  },
  image: {
    cases: [
      [
        "image",
        { kind: "image", src: "/a.png", props: { alt: "A cat", id: "pic", width: 40, height: 20 } },
      ],
      ["image (no alt)", { kind: "image", src: "/a.png" }],
      ["image (lazy)", { kind: "image", src: "/a.png", props: { loading: "lazy" } }],
    ],
  },
  video: {
    cases: [
      ["video", { kind: "video", src: "/a.mp4", controls: true, props: { id: "v" } }],
      ["video (autoplay)", { kind: "video", autoplay: true }],
      ["video (empty src)", { kind: "video", src: "" }],
    ],
  },
  divider: {
    cases: [
      ["divider", { kind: "divider", props: CONTAINER_PROPS }],
      ["divider (vertical)", { kind: "divider", props: { orientation: "vertical" } }],
    ],
  },
  spinner: {
    cases: [
      ["spinner", { kind: "spinner" }],
      // The two kinds whose base style reads a prop, which is the half of
      // `baseDecls` a bare node leaves unexercised.
      ["spinner (sized)", { kind: "spinner", props: { size: "lg" } }],
    ],
  },
  skeleton: {
    cases: [
      ["skeleton", { kind: "skeleton" }],
      ["skeleton (h)", { kind: "skeleton", props: { h: 120 } }],
    ],
  },
  progress: { cases: [["progress", { kind: "progress", value: 3, max: 10 }]] },
  toast: {
    cases: [
      ["toast", { kind: "toast", text: "Saved", level: "info" }],
      ["toast (no level)", { kind: "toast", text: "Saved" }],
      ["toast (empty level)", { kind: "toast", text: "", level: "" }],
    ],
  },
  error: {
    // The message itself is resolved from the slot's refinement at render time
    // and the server has no live refinement result to resolve — with no slot
    // behind the field both paths hold nothing, which is what this compares.
    cases: [["error", { kind: "error", field: "email" }]],
  },
  tooltip: {
    cases: [
      [
        "tooltip",
        { kind: "tooltip", text: "Why", placement: "top", children: [CHILD], props: TEXT_PROPS },
      ],
      ["tooltip (no placement)", { kind: "tooltip", text: "Why", children: [] }],
      [
        "tooltip (empty text and placement)",
        { kind: "tooltip", text: "", placement: "", children: [] },
      ],
    ],
  },
  list: {
    cases: [
      ["list", { kind: "list", children: [{ kind: "list-item", children: [CHILD] }] }],
      ["list (ordered)", { kind: "list", ordered: true, children: [], props: CONTAINER_PROPS }],
    ],
  },
  "list-item": { cases: [["list-item", { kind: "list-item", children: [CHILD] }]] },
  table: {
    cases: [
      [
        "table",
        {
          kind: "table",
          children: [
            {
              kind: "table-head",
              children: [{ kind: "table-row", children: [{ kind: "table-cell", children: [] }] }],
            },
          ],
          props: CONTAINER_PROPS,
        },
      ],
    ],
  },
  "table-head": { cases: [["table-head", { kind: "table-head", children: [] }]] },
  "table-body": { cases: [["table-body", { kind: "table-body", children: [] }]] },
  "table-row": { cases: [["table-row", { kind: "table-row", children: [] }]] },
  "table-cell": {
    cases: [
      ["table-cell", { kind: "table-cell", children: [CHILD], colspan: 2, rowspan: 3 }],
      ["table-cell (no span)", { kind: "table-cell", children: [] }],
      // FALSY: a zero span is no span — `colspan="0"` means "to the end of the
      // section", which is not what a tile that said nothing asked for.
      ["table-cell (zero spans)", { kind: "table-cell", children: [], colspan: 0, rowspan: 0 }],
    ],
  },
  modal: {
    cases: [
      [
        "modal (open)",
        { kind: "modal", open: true, title: "Confirm", children: [CHILD], props: CONTAINER_PROPS },
      ],
      // §10.6.1: a closed surface is served as the present-but-hidden host the
      // client mounts, not as nothing — otherwise hydration replaces the whole
      // subtree and a crawler never sees what is in it.
      ["modal (closed)", { kind: "modal", open: false, children: [CHILD] }],
      ["modal (no open field)", { kind: "modal", children: [] }],
    ],
  },
  drawer: {
    cases: [
      ["drawer (open)", { kind: "drawer", open: true, title: "Menu", children: [CHILD] }],
      ["drawer (right)", { kind: "drawer", side: "right", children: [] }],
      ["drawer (closed)", { kind: "drawer", open: false, children: [CHILD] }],
    ],
  },
  popover: {
    cases: [
      ["popover (open)", { kind: "popover", open: true, children: [CHILD] }],
      ["popover (closed)", { kind: "popover", open: false, children: [CHILD] }],
    ],
  },
  details: {
    cases: [
      [
        "details (open)",
        { kind: "details", summary: "More", open: true, children: [CHILD], props: { id: "d" } },
      ],
      ["details (closed)", { kind: "details", summary: "More", children: [CHILD] }],
    ],
  },
};

/**
 * Every kind the runtime can render, from the registry the mount path is built
 * from. The typed table above is the compile-time half of exhaustiveness; this
 * is the other direction. `TileRenderers` keys are optional
 * (`{ [K in TileNode["kind"]]?: … }`), so the union cannot force a kind to have
 * a renderer registered — a kind in the table that nothing renders, and a
 * renderer whose kind nobody compares, both fail here.
 */
const EVERY_TILE_KIND = Object.keys({
  ...layoutTiles,
  ...textTiles,
  ...inputTiles,
  ...collectionTiles,
  ...overlayTiles,
  ...mediaTiles,
  ...statusTiles,
}).sort();

describe("the server pass renders what the client renders", () => {
  it("compares every kind the runtime renders", () => {
    // The boundary this test used to leave invisible: half the kinds had no row
    // and nothing said so. Now a kind is either compared below or this fails.
    expect(EVERY_TILE_KIND).toEqual(Object.keys(TABLE).sort());
  });

  for (const [kind, row] of Object.entries(TABLE)) {
    const opts = { deep: true, text: row.noText === undefined };
    describe(kind, () => {
      for (const [label, node] of row.cases) {
        it(`agrees on ${label}`, () => {
          const client = clientElement(node);
          const server = serverElement(node);
          expect(shapeOf(server, opts)).toEqual(shapeOf(client, opts));
        });
      }
    });
  }

  it("carries the form state a live element cannot", () => {
    // The half of the contract `PROPERTY_ON_THE_CLIENT` takes out of the
    // comparison. A served page carries what the user will see filled in, and
    // the parity table cannot check it: an attribute dropped from both shapes
    // compares equal whether the server wrote it or not. Deleting `value` from
    // `ssr-render.ts` left the whole suite green until this existed.
    const input = serverElement({ kind: "input", value: "typed", type: "email" });
    expect(input.getAttribute("value")).toBe("typed");

    const check = serverElement({ kind: "check", checked: true });
    expect(check.querySelector("input")?.hasAttribute("checked")).toBe(true);
    const unchecked = serverElement({ kind: "check", checked: false });
    expect(unchecked.querySelector("input")?.hasAttribute("checked")).toBe(false);

    const radio = serverElement({ kind: "radio", group: "plan", value: "pro", selected: true });
    const radioInput = radio.querySelector("input");
    expect(radioInput?.getAttribute("value")).toBe("pro");
    expect(radioInput?.hasAttribute("checked")).toBe(true);

    const select = serverElement({
      kind: "select",
      value: "b",
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ],
    });
    const chosen = Array.from(select.querySelectorAll("option")).filter((o) =>
      o.hasAttribute("selected"),
    );
    expect(chosen.map((o) => o.textContent)).toEqual(["B"]);

    // A textarea's value is its text, which is why it is the one control whose
    // state the harness excludes one node down rather than by attribute name.
    expect(serverElement({ kind: "textarea", value: "note" }).textContent).toBe("note");

    const slider = serverElement({ kind: "slider", value: 5, min: 0, max: 10, step: 2 });
    expect(slider.getAttribute("value")).toBe("5");
    expect(slider.getAttribute("max")).toBe("10");

    const progress = serverElement({ kind: "progress", value: 3, max: 10 });
    expect(progress.getAttribute("value")).toBe("3");
    expect(progress.getAttribute("max")).toBe("10");
  });

  it("escapes what it puts in text and in an attribute", () => {
    // The only defence in a string-concatenated HTML builder, and nothing was
    // exercising it: the parity harness compares elements, and a browser parses
    // an injected tag into an element just as happily as an escaped one.
    const text = serverElement({ kind: "text", text: '<script>alert("x")</script> & more' });
    expect(text.querySelector("script")).toBeNull();
    expect(text.textContent).toBe('<script>alert("x")</script> & more');

    const img = serverElement({ kind: "image", src: "/a.png", props: { alt: '" onerror="boom' } });
    expect(img.getAttribute("alt")).toBe('" onerror="boom');
    expect(img.hasAttribute("onerror")).toBe(false);

    const md = serverElement({ kind: "markdown", text: "<script>alert(1)</script>" });
    expect(md.querySelector("script")).toBeNull();
    expect(md.textContent).toBe("<script>alert(1)</script>");
  });

  it("serves a closed overlay as the hidden host the client mounts", () => {
    // The divergence #296 left undecided, decided: the client renders a
    // present-but-hidden host so opening a surface is a style flip rather than
    // a mount, and the server has to serve that host — an empty string means
    // hydration rebuilds the subtree and a crawler is served nothing at all.
    const el = serverElement({
      kind: "modal",
      open: false,
      title: "Confirm",
      children: [{ kind: "text", text: "body" }],
    });
    expect(styleOf(el).display).toBe("none");
    expect(el.textContent).toContain("body");
  });

  it("resolves a responsive value to its base, which is all a server can know", () => {
    // `{base, md}` picks a breakpoint from `window.matchMedia` on the client.
    // There is no viewport on the server, so the base is what it emits — and
    // the client agrees on every viewport below the first declared breakpoint.
    // This is the one place the two paths are allowed to differ, which is why
    // it is asserted on the server alone rather than through the parity table.
    const node: TileNode = { kind: "row", children: [], props: { gap: { base: "sm", md: "xl" } } };
    expect(styleOf(serverElement(node)).gap).toBe("8px");
  });

  it("lets a card's own padding prop suppress the default even when it resolves to nothing", () => {
    // Asking for padding is what turns the default off, and a responsive map
    // with no base asks for it — the renderer reads the prop's presence, not
    // its resolved value, and so does the server. Also not a parity case: at a
    // wide enough viewport the client resolves the `md` arm and the server
    // cannot.
    const node: TileNode = { kind: "card", children: [], props: { pad: { md: "xl" } } };
    // Read through a longhand: the CSSOM expands the `padding` shorthand, so
    // the shorthand name is absent from a parsed declaration list either way.
    expect(styleOf(serverElement(node))["padding-top"]).toBeUndefined();
    expect(styleOf(serverElement({ kind: "card", children: [] }))["padding-top"]).toBe("16px");
  });
});
